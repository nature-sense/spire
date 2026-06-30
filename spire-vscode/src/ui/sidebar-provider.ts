import * as vscode from 'vscode';
import { Message } from '../core/models/message';
import { IOrchestrator } from '../core/interfaces/orchestrator';
import { ILLMProvider } from '../core/interfaces/llm-provider';
import { IToolRegistry } from '../core/interfaces/tool-registry';
import { IMemoryGraph } from '../core/interfaces/memory';
import { WorkspaceContext } from '../core/models/context';
import { ContextBuilder } from '../orchestration/context-builder';
import { getSidebarHtml } from './sidebar-html';
import { getMcpHtml } from './mcp-html';
import { marked } from 'marked';
import { McpManager } from '../mcp/mcp-manager';
import { McpObservability } from '../monitoring/mcp-observability';

// ── Graph Prompt Augmentation ──────────────────────────────────
import { GraphPromptAugmenter } from '../augmenter/GraphPromptAugmenter';
import { SessionProvider } from '../providers/SessionProvider';


/**
 * VS Code WebviewView provider for the sidebar chat.
 * This is the main user-facing component of Spire.
 *
 * SESSION MANAGEMENT:
 * - If no session is active, the first prompt auto-creates one
 *   (title derived from the prompt text)
 * - Each exchange is stored as a conversation node in the graph,
 *   linked to the current session
 * - "close session" / "end session" closes the current session
 * - "resume <project> session" re-activates a past session
 * - Past sessions remain queryable via semantic search
 */
export class SpireSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'spireSidebar';
  private _view?: vscode.WebviewView;
  private _conversationHistory: Message[] = [];
  private _orchestrator: IOrchestrator;
  private _contextBuilder: ContextBuilder;
  private _graphAugmenter?: GraphPromptAugmenter;
  private _mcpManager?: McpManager;
  private _mcpObservability?: McpObservability;

  /** Session management provider — tracks current session ID */
  private _sessionProvider?: SessionProvider;

  /** Memory graph for graph visualization data */
  private _memoryGraph?: IMemoryGraph;

  constructor(
    private readonly _extensionContext: vscode.ExtensionContext,
    orchestrator: IOrchestrator,
    graphAugmenter?: GraphPromptAugmenter,
    mcpManager?: McpManager,
    mcpObservability?: McpObservability,
    memoryGraph?: IMemoryGraph
  ) {
    this._graphAugmenter = graphAugmenter;
    this._mcpManager = mcpManager;
    this._mcpObservability = mcpObservability;
    this._memoryGraph = memoryGraph;
  
    this._orchestrator = orchestrator;
    const config = vscode.workspace.getConfiguration('spire');
    const workspaceRoot = config.get<string>('workspaceRoot');
    this._contextBuilder = new ContextBuilder({ workspaceRoot: workspaceRoot || undefined });
  }

  /**
   * Set the session provider for session management.
   * Called during extension initialization after the augmenter is set up.
   */
  setSessionProvider(provider: SessionProvider): void {
    this._sessionProvider = provider;
    console.log('[SpireSidebar] Session provider attached');
  }

  /**
   * Get the current session ID, or null if no session is active.
   */
  private _getCurrentSessionId(): string | null {
    return this._sessionProvider?._getCurrentSessionId() ?? null;
  }

  /**
   * Ensure a session exists. If no session is active, auto-create one
   * from the prompt text. Returns the current session ID.
   *
   * Sessions are stored as 'session' nodes in the local MemoryGraph
   * (not via MCP — the graph-memory MCP server is legacy).
   */
  private async _ensureSession(prompt: string): Promise<string | null> {
    if (!this._sessionProvider) {
      return null;
    }

    const currentId = this._sessionProvider._getCurrentSessionId();
    if (currentId) {
      return currentId; // Session already active
    }

    // Auto-create a session with a title derived from the prompt
    const title = prompt.substring(0, 60).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'New session';

    try {
      // Store a session node in the local MemoryGraph
      const sessionNode = await this._memoryGraph!.storeNode({
        type: 'session',
        name: title,
        description: `Session started: ${title}`,
        properties: {
          title,
          userId: 'default-user',
          startedAt: new Date().toISOString(),
          status: 'active',
        },
      });

      this._sessionProvider.setCurrentSessionId(sessionNode.id);
      console.log(`[SpireSidebar] Auto-created session: "${title}" (${sessionNode.id})`);
      return sessionNode.id;
    } catch (err) {
      console.warn('[SpireSidebar] Failed to auto-create session:', (err as Error).message);
    }

    return null;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };

    webviewView.webview.html = getSidebarHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {

      try {
        switch (message.type) {
          case 'ready':
            // Webview JS has initialised — now safe to restore conversation history.
            // Parse markdown for assistant messages before restoring (they are stored as raw markdown).
            if (this._conversationHistory.length > 0) {
              const parsedMessages = this._conversationHistory.map(msg => ({
                ...msg,
                content: msg.role === 'assistant' ? marked.parse(msg.content) : msg.content
              }));
              webviewView.webview.postMessage({
                type: 'restoreConversation',
                messages: parsedMessages
              });
            }
            break;
          case 'ask':
            await this._handleAsk(webviewView, message.content);
            break;
          case 'setApiKey':
            await vscode.commands.executeCommand('spire.setApiKey');
            break;
          case 'initMemoryBank':
            await vscode.commands.executeCommand('spire.initMemoryBank');
            break;
          case 'loadContext':
            await this._handleLoadContext(webviewView);
            break;
          case 'clear':
            this._conversationHistory = [];
            webviewView.webview.postMessage({ type: 'cleared' });
            break;
          case 'mcp.refresh':
            this._refreshMcp();
            break;
          case 'mcp.restart':
            if (this._mcpManager && message.content) {
              await this._mcpManager.restartServer(message.content);
              this._refreshMcp();
            }
            break;
          case 'mcp.disconnect':
            if (this._mcpManager && message.content) {
              await this._mcpManager.disconnectServer(message.content);
              this._refreshMcp();
            }
            break;
          case 'graph.refresh':
            await this._handleGraphRefresh(webviewView);
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        webviewView.webview.postMessage({ type: 'error', content: 'Internal error: ' + msg });
      }
    });
  }

  private async _handleAsk(webviewView: vscode.WebviewView, text: string): Promise<void> {
    if (!this._orchestrator) {
      webviewView.webview.postMessage({ type: 'error', content: 'Spire is not initialized. Please reload.' });
      return;
    }

    // Step 1: Ensure a session exists (auto-create if none active)
    const sessionId = await this._ensureSession(text);
    if (sessionId) {
      console.log(`[SpireSidebar] Active session: ${sessionId}`);
    }

    // Step 2: Augment the prompt with graph knowledge context (if applicable)
    let augmentedText = text;
    if (this._graphAugmenter) {
      try {
        augmentedText = await this._graphAugmenter.processPrompt(text);
        if (augmentedText !== text) {
          console.log('[SpireSidebar] Prompt augmented with graph knowledge context');
        }
      } catch (err) {
        // Graceful degradation: use original text on error
        console.warn('[SpireSidebar] Graph augmentation failed, using original prompt:', (err as Error).message);
        augmentedText = text;
      }
    }

    // Store the original user text in conversation history
    this._conversationHistory.push({ role: 'user', content: text });

    try {
      // Build fresh context for this request
      const context: WorkspaceContext = await this._contextBuilder.build();
      this._orchestrator.setContext(context);

      // Process through orchestrator (with augmented prompt if available)
      // Wire status updates to the webview in real-time
      const result = await this._orchestrator.handleUserRequest(augmentedText, {
        onStatusUpdate: (status) => {
          webviewView.webview.postMessage({ type: 'statusUpdate', status });
        }
      });
      this._conversationHistory.push({ role: 'assistant', content: result.content, reasoning: result.reasoning });
      webviewView.webview.postMessage({
        type: 'response',
        content: marked.parse(result.content),
        reasoning: result.reasoning
      });

      // Step 3: Store the exchange in the knowledge graph for future retrieval
      if (this._graphAugmenter) {
        try {
          await this._graphAugmenter.storeExchange({
            originalPrompt: text,
            llmResponse: result.content,
            sessionId: this._getCurrentSessionId() ?? undefined,
          });
          // Auto-refresh the graph view so new nodes appear immediately
          if (this._view) {
            this._handleGraphRefresh(this._view).catch(() => {});
          }
        } catch (err) {
          // Non-critical — don't surface to user
          console.warn('[SpireSidebar] Failed to store conversation exchange:', (err as Error).message);
        }
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      webviewView.webview.postMessage({ type: 'error', content: msg });
    }
  }


  private async _handleLoadContext(webviewView: vscode.WebviewView): Promise<void> {
    const context = await this._contextBuilder.build();
    const parts: string[] = [];

    if (context.projectInfo) {
      parts.push(`**Workspace:** ${context.projectInfo.name}`);
    }
    if (context.currentFile) {
      parts.push(`**Current File:** ${context.currentFile.path}`);
    }
    if (context.openFiles && context.openFiles.length > 0) {
      parts.push(`**Open Files:** ${context.openFiles.length} tab(s)`);
    }
    if (context.diagnostics && context.diagnostics.length > 0) {
      parts.push(`**Diagnostics:** ${context.diagnostics.length} issue(s)`);
    }

    const summary = parts.length > 0
      ? parts.join('  \n')
      : '**Context:** No workspace open.';

    webviewView.webview.postMessage({ type: 'contextLoaded', content: marked.parse(summary) });

  }

  public postMessage(message: any): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  public reveal(): void {
    if (this._view) {
      this._view.show?.(true);
    }
  }

  public showTab(tab: 'prompt' | 'mcp' | 'graph'): void {
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ type: 'switchTab', tab });
    }
  }

  /**
   * Handle graph.refresh message from the webview.
   * Queries the memory graph for all nodes and relationships,
   * then sends the serialized data back to the webview.
   */
  private async _handleGraphRefresh(webviewView: vscode.WebviewView): Promise<void> {
    if (!this._memoryGraph) {
      webviewView.webview.postMessage({
        type: 'graph.data',
        content: { nodes: [], edges: [] }
      });
      return;
    }

    try {
      // Fetch all nodes from the graph
      const nodes = await this._memoryGraph.queryNodes({});
      
      // Build edges from relationships
      const edges: Array<{ from: string; to: string; type: string }> = [];
      for (const node of nodes) {
        try {
          const rels = await this._memoryGraph.getRelationships(node.id);
          for (const rel of rels) {
            edges.push({
              from: rel.fromId,
              to: rel.toId,
              type: rel.type
            });
          }
        } catch {
          // Skip if node has no relationships
        }
      }

      // Serialize nodes for the webview (strip non-serializable fields)
      const serializedNodes = nodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        description: n.description || '',
        properties: n.properties || {}
      }));

      webviewView.webview.postMessage({
        type: 'graph.data',
        content: {
          nodes: serializedNodes,
          edges
        }
      });
    } catch (err) {
      console.warn('[SpireSidebar] Failed to load graph data:', (err as Error).message);
      webviewView.webview.postMessage({
        type: 'graph.data',
        content: { nodes: [], edges: [] }
      });
    }
  }

  private _refreshMcp(): void {
    if (this._view && this._mcpManager && this._mcpObservability) {
      const html = getMcpHtml(this._mcpManager, this._mcpObservability);
      this._view.webview.postMessage({ type: 'mcpUpdate', html });
    }
  }
}
