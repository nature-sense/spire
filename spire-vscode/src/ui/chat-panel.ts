import * as vscode from 'vscode';
import { Message } from '../core/models/message';
import { IOrchestrator } from '../core/interfaces/orchestrator';
import { getSidebarHtml } from './sidebar-html';
import { marked } from 'marked';

// ── Graph Prompt Augmentation ──────────────────────────────────
import { GraphPromptAugmenter } from '../augmenter/GraphPromptAugmenter';

/**
 * Webview panel for the Spire chat interface.
 * Provides a side-by-side or standalone chat view.
 */
export class SpireChatPanel {
  public static readonly viewType = 'spireChatPanel';
  private static instance: SpireChatPanel | undefined;

  private panel: vscode.WebviewPanel | undefined;
  private conversationHistory: Message[] = [];
  private orchestrator: IOrchestrator;
  private graphAugmenter?: GraphPromptAugmenter;

  private constructor(orchestrator: IOrchestrator, graphAugmenter?: GraphPromptAugmenter) {
    this.orchestrator = orchestrator;
    this.graphAugmenter = graphAugmenter;
  }

  static getInstance(
    orchestrator: IOrchestrator,
    graphAugmenter?: GraphPromptAugmenter
  ): SpireChatPanel {
    if (!SpireChatPanel.instance) {
      SpireChatPanel.instance = new SpireChatPanel(orchestrator, graphAugmenter);
    } else {
      SpireChatPanel.instance.orchestrator = orchestrator;
      SpireChatPanel.instance.graphAugmenter = graphAugmenter;
    }
    return SpireChatPanel.instance;
  }

  /**
   * Show the chat panel (reveal existing or create new).
   */
  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      SpireChatPanel.viewType,
      'Spire Chat',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = getSidebarHtml();
    this.setupMessageHandlers();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * Post a message to the webview.
   */
  postMessage(message: any): void {
    this.panel?.webview.postMessage(message);
  }

  private setupMessageHandlers(): void {
    if (!this.panel) return;

    this.panel.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case 'ready':
            // Webview JS has initialised — restore conversation history.
            // Parse markdown for assistant messages (stored as raw markdown).
            if (this.conversationHistory.length > 0) {
              const parsedMessages = this.conversationHistory.map(msg => ({
                ...msg,
                content: msg.role === 'assistant' ? marked.parse(msg.content) : msg.content
              }));
              this.postMessage({
                type: 'restoreConversation',
                messages: parsedMessages
              });
            }
            break;
          case 'ask':
            await this.handleAsk(message.content);
            break;
          case 'setApiKey':
            await vscode.commands.executeCommand('spire.setApiKey');
            break;
          case 'initMemoryBank':
            await vscode.commands.executeCommand('spire.initMemoryBank');
            break;
          case 'loadContext':
            await vscode.commands.executeCommand('spire.loadContext');
            break;
          case 'clear':
            this.conversationHistory = [];
            this.postMessage({ type: 'cleared' });
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.postMessage({ type: 'error', content: 'Internal error: ' + msg });
      }
    });
  }

  private async handleAsk(text: string): Promise<void> {
    if (!this.orchestrator) {
      this.postMessage({ type: 'error', content: 'Spire is not initialized. Please reload.' });
      return;
    }

    // Step 1: Augment the prompt with graph knowledge context (if applicable)
    let augmentedText = text;
    if (this.graphAugmenter) {
      try {
        augmentedText = await this.graphAugmenter.processPrompt(text);
        if (augmentedText !== text) {
          console.log('[SpireChatPanel] Prompt augmented with graph knowledge context');
        }
      } catch (err) {
        console.warn('[SpireChatPanel] Graph augmentation failed, using original prompt:', (err as Error).message);
        augmentedText = text;
      }
    }

    try {
      // Process through orchestrator (with augmented prompt if available)
      // Wire status updates to the webview in real-time
      const result = await this.orchestrator.handleUserRequest(augmentedText, {
        onStatusUpdate: (status) => {
          this.postMessage({ type: 'statusUpdate', status });
        }
      });
      // Store original user text in conversation history (not augmented)
      this.conversationHistory.push({ role: 'user', content: text });
      this.conversationHistory.push({ role: 'assistant', content: result.content });
      this.postMessage({
        type: 'response',
        content: marked.parse(result.content),
        reasoning: result.reasoning
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.postMessage({ type: 'error', content: msg });
    }
  }

}
