import * as vscode from 'vscode';
import { Message } from '../core/models/message';
import { IOrchestrator } from '../core/interfaces/orchestrator';
import { ILLMProvider } from '../core/interfaces/llm-provider';
import { IToolRegistry } from '../core/interfaces/tool-registry';
import { WorkspaceContext } from '../core/models/context';
import { ContextBuilder } from '../orchestration/context-builder';
import { getChatHtml } from './chat-html';
import { marked } from 'marked';

// ── Graph Prompt Augmentation ──────────────────────────────────
import { GraphPromptAugmenter } from '../augmenter/GraphPromptAugmenter';


/**
 * VS Code WebviewView provider for the sidebar chat.
 * This is the main user-facing component of Spire.
 */
export class SpireSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'spireSidebar';
  private _view?: vscode.WebviewView;
  private _conversationHistory: Message[] = [];
  private _orchestrator: IOrchestrator;
  private _contextBuilder: ContextBuilder;
  private _graphAugmenter?: GraphPromptAugmenter;

  constructor(
    private readonly _extensionContext: vscode.ExtensionContext,
    orchestrator: IOrchestrator,
    graphAugmenter?: GraphPromptAugmenter
  ) {
    this._graphAugmenter = graphAugmenter;
  
    this._orchestrator = orchestrator;
    const config = vscode.workspace.getConfiguration('spire');
    const workspaceRoot = config.get<string>('workspaceRoot');
    this._contextBuilder = new ContextBuilder({ workspaceRoot: workspaceRoot || undefined });
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

    webviewView.webview.html = getChatHtml();

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

    // Step 1: Augment the prompt with graph knowledge context (if applicable)
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
      const result = await this._orchestrator.handleUserRequest(augmentedText);
      this._conversationHistory.push({ role: 'assistant', content: result.content });
      webviewView.webview.postMessage({
        type: 'response',
        content: marked.parse(result.content),
        reasoning: result.reasoning
      });

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
}
