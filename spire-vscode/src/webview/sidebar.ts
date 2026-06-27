import * as vscode from 'vscode';
import { Message } from '../core/models/message';
import { DeepSeekProvider, DeepSeekConfig } from '../llm/deepseek/deepseek-provider';
import { Orchestrator } from '../orchestration/orchestrator';
import { loadConfig, SpireConfig } from '../config/config';
import { loadMemoryBank } from '../context/memoryBank';
import { loadClineRules } from '../context/rules';

export class SpireSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'spireSidebar';
  private _view?: vscode.WebviewView;
  private _conversationHistory: Message[] = [];
  private _orchestrator?: Orchestrator;
  private _provider?: DeepSeekProvider;

  constructor(private readonly _extensionContext: vscode.ExtensionContext) {
    console.log('SpireSidebarProvider constructor called');
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void {
    console.log('SpireSidebarProvider.resolveWebviewView called');

    this._view = webviewView;
    this._initializeEngine();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };

    const html = this._getHtml();
    webviewView.webview.html = html;

    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log('Spire: received message type=' + message.type);
      try {
        switch (message.type) {
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
            this._initializeEngine();
            webviewView.webview.postMessage({ type: 'cleared' });
            break;
          case 'modelChange':
            this._initializeEngine(message.model);
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Spire: message handler error:', msg);
        webviewView.webview.postMessage({ type: 'error', content: 'Internal error: ' + msg });
      }
    });
  }

  private _initializeEngine(model?: string): void {
    const config = loadConfig();
    const providerConfig: DeepSeekConfig = {
      apiKey: config.apiKey,
      model: (model as DeepSeekConfig['model']) || config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens
    };

    this._provider = new DeepSeekProvider(providerConfig);
    this._orchestrator = new Orchestrator(this._provider);
  }

  private async _handleAsk(webviewView: vscode.WebviewView, text: string): Promise<void> {
    const orchestrator = this._orchestrator;
    if (!orchestrator) {
      webviewView.webview.postMessage({ type: 'error', content: 'Spire is not initialized. Please reload.' });
      return;
    }

    const config = loadConfig();
    if (!config.apiKey) {
      webviewView.webview.postMessage({
        type: 'error',
        content: '🔑 API key not configured. Click "Key" in the toolbar to set your DeepSeek API key.'
      });
      return;
    }

    this._conversationHistory.push({ role: 'user', content: text });

    try {
      // Build context for orchestrator
      const context = await this._buildContext(config);
      orchestrator.setContext(context);

      // Send conversation history through orchestrator
      const response = await orchestrator.handleUserRequest(text);
      this._conversationHistory.push({ role: 'assistant', content: response.content });
      webviewView.webview.postMessage({
        type: 'response',
        content: response.content,
        reasoning: response.reasoning
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      webviewView.webview.postMessage({ type: 'error', content: msg });
    }
  }

  private async _buildContext(config: SpireConfig): Promise<any> {
    // Gather workspace context
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const activeEditor = vscode.window.activeTextEditor;

    const context: any = {};

    // Project info
    if (workspaceFolders && workspaceFolders.length > 0) {
      context.projectInfo = {
        name: workspaceFolders[0].name,
        path: workspaceFolders[0].uri.fsPath
      };
    }

    // Current file
    if (activeEditor) {
      context.currentFile = {
        path: activeEditor.document.uri.fsPath,
        language: activeEditor.document.languageId,
        content: activeEditor.document.getText()
      };
    }

    // Load Memory Bank and Cline Rules for context
    if (config.useMemoryBank) {
      const memoryBank = await loadMemoryBank();
      context.memoryBank = memoryBank;
    }

    if (config.useClineRules) {
      const clineRules = await loadClineRules();
      context.clineRules = clineRules;
    }

    return context;
  }

  private async _handleLoadContext(webviewView: vscode.WebviewView): Promise<void> {
    const config = loadConfig();
    const memoryBank = await loadMemoryBank();
    const clineRules = await loadClineRules();

    const parts: string[] = [];
    const mbFiles = Object.entries(memoryBank).filter(([, v]) => v && v.trim().length > 0);
    if (mbFiles.length > 0) {
      parts.push('**Memory Bank:** ' + mbFiles.map(([k]) => k).join(', '));
    } else {
      parts.push('**Memory Bank:** (empty — run "Init Memory Bank" to create templates)');
    }
    if (clineRules.trim()) {
      const ruleCount = clineRules.split('\n\n').length;
      parts.push('**Cline Rules:** ' + ruleCount + ' rule section(s) loaded');
    } else {
      parts.push('**Cline Rules:** (none found)');
    }

    // Add workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      parts.push('**Workspace:** ' + workspaceFolders[0].name);
    }

    const summary = parts.join('  \n');
    webviewView.webview.postMessage({ type: 'contextLoaded', content: summary });
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

  private _getHtml(): string {
    let s = '';
    s += '<!DOCTYPE html>\n';
    s += '<html>\n';
    s += '<head>\n';
    s += '<meta charset="UTF-8">\n';
    s += '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:;">\n';
    s += '<title>Spire</title>\n';
    s += '<style>\n';
    s += '* { box-sizing: border-box; margin: 0; padding: 0; }\n';
    s += 'body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-sideBar-background); height: 100vh; display: flex; flex-direction: column; padding: 8px; overflow: hidden; }\n';
    s += '.header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }\n';
    s += '.logo { font-size: 16px; font-weight: 700; }\n';
    s += '.toolbar { display: flex; gap: 4px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 4px; flex-shrink: 0; flex-wrap: wrap; }\n';
    s += '.toolbar button { background: transparent; color: var(--vscode-descriptionForeground); border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 3px; }\n';
    s += '.toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-editor-foreground); }\n';
    s += '.toolbar .spacer { flex: 1; }\n';
    s += '.toolbar .clear-btn { color: var(--vscode-errorForeground); }\n';
    s += '.chat-container { flex: 1; overflow-y: auto; padding: 4px 0; display: flex; flex-direction: column; gap: 4px; min-height: 0; }\n';
    s += '.message { max-width: 90%; padding: 6px 10px; border-radius: 6px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }\n';
    s += '.message.user { align-self: flex-end; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }\n';
    s += '.message.assistant { align-self: flex-start; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }\n';
    s += '.message .label { font-size: 10px; font-weight: 600; opacity: 0.6; display: block; margin-bottom: 2px; }\n';
    s += '.input-area { display: flex; gap: 6px; padding: 6px 0 0; border-top: 1px solid var(--vscode-panel-border); flex-shrink: 0; }\n';
    s += '.input-area textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px 8px; font-size: 13px; font-family: var(--vscode-font-family); resize: none; outline: none; min-height: 32px; max-height: 80px; line-height: 1.4; }\n';
    s += '.input-area textarea:focus { border-color: var(--vscode-focusBorder); }\n';
    s += '.input-area button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 14px; font-size: 13px; cursor: pointer; flex-shrink: 0; align-self: flex-end; }\n';
    s += '.input-area button:hover { background: var(--vscode-button-hoverBackground); }\n';
    s += '.input-area button:disabled { opacity: 0.5; cursor: not-allowed; }\n';
    s += '.error-message { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); padding: 6px 10px; border-radius: 4px; margin: 4px 0; font-size: 13px; }\n';
    s += '.status-bar { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 4px 0; border-top: 1px solid var(--vscode-panel-border); margin-top: 4px; flex-shrink: 0; text-align: center; }\n';
  // Markdown-rendered content styles
  s += '.msg-body h1, .msg-body h2, .msg-body h3, .msg-body h4, .msg-body h5, .msg-body h6 { margin: 8px 0 4px 0; font-weight: 600; line-height: 1.3; }\n';
  s += '.msg-body h1 { font-size: 18px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }\n';
  s += '.msg-body h2 { font-size: 16px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 3px; }\n';
  s += '.msg-body h3 { font-size: 15px; }\n';
  s += '.msg-body h4 { font-size: 14px; }\n';
  s += '.msg-body p { margin: 4px 0; }\n';
  s += '.msg-body ul, .msg-body ol { margin: 4px 0; padding-left: 22px; }\n';
  s += '.msg-body li { margin: 2px 0; }\n';
  s += '.msg-body blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid #f0883e; color: var(--vscode-descriptionForeground); font-style: italic; }\n';
  s += '.msg-body pre { margin: 8px 0; padding: 10px; background: var(--vscode-textCodeBlock-background, #1e1e1e); border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow-x: auto; }\n';
  s += '.msg-body code { font-family: var(--vscode-editor-font-family, "Cascadia Code", "Fira Code", monospace); font-size: 12px; }\n';
  s += '.msg-body pre code { background: none; padding: 0; border: none; }\n';
  s += '.msg-body :not(pre) > code { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 1px 4px; border-radius: 3px; border: 1px solid var(--vscode-panel-border); }\n';
  s += '.msg-body table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px; }\n';
  s += '.msg-body th, .msg-body td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; }\n';
  s += '.msg-body th { background: var(--vscode-sideBarSectionHeader-background, #2d2d2d); font-weight: 600; }\n';
  s += '.msg-body tr:nth-child(even) { background: var(--vscode-list-hoverBackground, #2a2d2e); }\n';
  s += '.msg-body hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 10px 0; }\n';
  s += '.msg-body img { max-width: 100%; border-radius: 4px; margin: 4px 0; }\n';
  s += '.msg-body a { color: var(--vscode-textLink-foreground, #58a6ff); text-decoration: underline; }\n';
  s += '.msg-body a:hover { color: var(--vscode-textLink-activeForeground, #79c0ff); }\n';

    s += '</style>\n';
    s += '</head>\n';
    s += '<body>\n';
    s += '<div class="header"><span class="logo">⛰️ Spire</span></div>\n';
    s += '<div class="toolbar">\n';
    s += '<button id="setApiKeyBtn">🔑 Key</button>\n';
    s += '<button id="initMemoryBtn">📁 Memory</button>\n';
    s += '<button id="loadContextBtn">📂 Context</button>\n';
    s += '<span class="spacer"></span>\n';
    s += '<button id="clearBtn" class="clear-btn">🗑️ Clear</button>\n';
    s += '</div>\n';
    s += '<div class="chat-container" id="chatContainer"></div>\n';
    s += '<div class="input-area">\n';
    s += '<textarea id="userInput" rows="1" placeholder="Ask Spire..." spellcheck="false"></textarea>\n';
    s += '<button id="sendBtn">Send</button>\n';
    s += '</div>\n';
    s += '<div class="status-bar" id="statusBar">Ready</div>\n';
    s += '<script>\n';
    s += '"use strict";\n';
    s += '(function(){\n';
    s += '  var vs = null;\n';
    s += '  try { vs = acquireVsCodeApi(); } catch(e){}\n';
    s += '  if (!vs) { document.getElementById("statusBar").textContent = "NO VSCODE API"; return; }\n';
    s += '  var chat = document.getElementById("chatContainer");\n';
    s += '  var input = document.getElementById("userInput");\n';
    s += '  var sendBtn = document.getElementById("sendBtn");\n';
    s += '  var statusBar = document.getElementById("statusBar");\n';
    s += '  function addMsg(cls, html) {\n';
    s += '    var d = document.createElement("div");\n';
    s += '    d.className = cls;\n';
    s += '    d.innerHTML = html;\n';
    s += '    chat.appendChild(d);\n';
    s += '    chat.scrollTop = chat.scrollHeight;\n';
    s += '  }\n';
    s += '  function addErr(text) {\n';
    s += '    var d = document.createElement("div");\n';
    s += '    d.className = "error-message";\n';
    s += '    d.textContent = text;\n';
    s += '    chat.appendChild(d);\n';
    s += '    chat.scrollTop = chat.scrollHeight;\n';
    s += '  }\n';
    s += '  sendBtn.addEventListener("click", function() {\n';
    s += '    var text = input.value.trim();\n';
    s += '    if (!text) return;\n';
    s += '    input.value = "";\n';
    s += '    addMsg("message user", "<span class=\\"label\\">You</span>" + text.replace(/\\n/g, "<br>"));\n';
    s += '    statusBar.textContent = "Sending...";\n';
    s += '    vs.postMessage({ type: "ask", content: text });\n';
    s += '  });\n';
    s += '  input.addEventListener("keydown", function(e) {\n';
    s += '    if (e.key === "Enter" && !e.shiftKey) {\n';
    s += '      e.preventDefault();\n';
    s += '      sendBtn.click();\n';
    s += '    }\n';
    s += '  });\n';
    s += '  document.getElementById("clearBtn").addEventListener("click", function() {\n';
    s += '    chat.innerHTML = "";\n';
    s += '    statusBar.textContent = "Cleared";\n';
    s += '    vs.postMessage({ type: "clear" });\n';
    s += '  });\n';
    s += '  document.getElementById("setApiKeyBtn").addEventListener("click", function() {\n';
    s += '    vs.postMessage({ type: "setApiKey" });\n';
    s += '  });\n';
    s += '  document.getElementById("initMemoryBtn").addEventListener("click", function() {\n';
    s += '    vs.postMessage({ type: "initMemoryBank" });\n';
    s += '    statusBar.textContent = "Initializing memory bank...";\n';
    s += '  });\n';
    s += '  document.getElementById("loadContextBtn").addEventListener("click", function() {\n';
    s += '    vs.postMessage({ type: "loadContext" });\n';
    s += '    statusBar.textContent = "Loading context...";\n';
    s += '  });\n';
    s += '  window.addEventListener("message", function(event) {\n';
    s += '    var msg = event.data;\n';
    s += '    if (msg.type === "response") {\n';
    s += '      addMsg("message assistant", "<span class=\\"label\\">Spire</span>" + (msg.content || ""));\n';
    s += '      statusBar.textContent = "Ready";\n';
    s += '    } else if (msg.type === "error") {\n';
    s += '      addErr(msg.content || "Unknown error");\n';
    s += '      statusBar.textContent = "Error";\n';
    s += '    } else if (msg.type === "contextLoaded") {\n';
    s += '      addMsg("message assistant", "<span class=\\"label\\">Spire</span>" + (msg.content || ""));\n';
    s += '      statusBar.textContent = "Ready";\n';
    s += '    } else if (msg.type === "cleared") {\n';
    s += '      statusBar.textContent = "Ready";\n';
    s += '    }\n';
    s += '  });\n';
    s += '  statusBar.textContent = "Ready";\n';
    s += '})();\n';
    s += '</script>\n';
    s += '</body>\n';
    s += '</html>\n';
    return s;
  }
}
