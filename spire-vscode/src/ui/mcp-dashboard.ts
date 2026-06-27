import * as vscode from 'vscode';
import { ServiceStatus } from '../core/interfaces/mcp-client';
import { McpManager } from '../mcp/mcp-manager';
import { McpObservability, McpServerMetrics } from '../monitoring/mcp-observability';
import { HealthResult } from '../monitoring/health-service';

/**
 * WebviewView provider for the MCP Dashboard.
 *
 * Shows per-server status, metrics, logs, and restart buttons.
 */
export class McpDashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'spireMCPDashboard';

  private _view?: vscode.WebviewView;
  private manager: McpManager;
  private observability: McpObservability;

  constructor(manager: McpManager, observability: McpObservability) {
    this.manager = manager;
    this.observability = observability;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'restart':
          try {
            await this.manager.restartServer(message.serverId);
            this.postMessage({ type: 'toast', text: `Restarted ${message.serverId}` });
            this.refresh();
          } catch (err) {
            this.postMessage({ type: 'toast', text: `Failed: ${(err as Error).message}` });
          }
          break;

        case 'refresh':
          this.refresh();
          break;

        case 'disconnect':
          try {
            await this.manager.disconnectServer(message.serverId);
            this.postMessage({ type: 'toast', text: `Disconnected ${message.serverId}` });
            this.refresh();
          } catch (err) {
            this.postMessage({ type: 'toast', text: `Failed: ${(err as Error).message}` });
          }
          break;
      }
    });

    // Initial render
    this.refresh();
  }

  /** Refresh the dashboard content */
  async refresh(): Promise<void> {
    if (!this._view) return;

    const servers = this.manager.listConfiguredServers();
    const metrics = this.observability.getAllMetrics();
    const traces = this.observability.getTraces(20);
    const statusHistory = this.observability.getStatusHistory(10);

    let html = this.getHtml();
    html = html.replace('<!-- SERVERS -->', this.renderServers(servers, metrics));
    html = html.replace('<!-- TRACES -->', this.renderTraces(traces));
    html = html.replace('<!-- HISTORY -->', this.renderHistory(statusHistory));
    html = html.replace('<!-- SUMMARY -->', this.renderSummary(metrics));

    this._view.webview.html = html;
  }

  /** Expose refresh for external callers (e.g., status bar click) */
  reveal(): void {
    if (this._view) {
      this._view.show?.(true);
      this.refresh();
    }
  }

  // ── HTML rendering ──────────────────────────────────────────────

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 8px;
      margin: 0;
    }
    h2 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; }
    h3 { margin: 12px 0 6px 0; font-size: 13px; font-weight: 600; }
    .server-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .server-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .server-name {
      font-weight: 600;
      font-size: 13px;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-running { background: #1b5e20; color: #a5d6a7; }
    .status-starting { background: #e65100; color: #ffe0b2; }
    .status-retrying { background: #e65100; color: #ffe0b2; }
    .status-failed { background: #b71c1c; color: #ef9a9a; }
    .status-stopped { background: #424242; color: #bdbdbd; }
    .server-details {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .server-details td {
      padding: 1px 8px 1px 0;
    }
    .btn {
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-danger {
      background: var(--vscode-errorForeground, #b71c1c);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    .trace-log {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      background: var(--vscode-textBlockQuote-background);
      padding: 6px;
      border-radius: 3px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
    .history-item {
      font-size: 11px;
      padding: 2px 0;
      border-bottom: 1px solid var(--vscode-widget-border, #333);
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      font-size: 11px;
    }
    .summary-item {
      background: var(--vscode-textBlockQuote-background);
      padding: 4px 6px;
      border-radius: 3px;
    }
    .summary-value {
      font-weight: 600;
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" onclick="postMsg('refresh')">⟳ Refresh</button>
  </div>

  <h2>MCP Servers</h2>
  <div id="summary"><!-- SUMMARY --></div>
  <div id="servers"><!-- SERVERS --></div>

  <h3>Recent Events</h3>
  <div id="history"><!-- HISTORY --></div>

  <h3>Trace Log</h3>
  <div id="traces"><!-- TRACES --></div>

  <script>
    const vscode = acquireVsCodeApi();
    function postMsg(command, serverId) {
      vscode.postMessage({ command, serverId });
    }
  </script>
</body>
</html>`;
  }

  private renderSummary(metrics: McpServerMetrics[]): string {
    const totalCalls = metrics.reduce((s, m) => s + m.totalToolCalls, 0);
    const totalErrors = metrics.reduce((s, m) => s + m.errorCount, 0);
    const totalFailed = metrics.reduce((s, m) => s + m.failedToolCalls, 0);
    const avgLatency = metrics.length > 0
      ? Math.round(metrics.reduce((s, m) => s + m.avgLatencyMs, 0) / metrics.length)
      : 0;

    return `
<div class="summary-grid">
  <div class="summary-item">
    <div class="summary-value">${metrics.length}</div>
    <div>Servers</div>
  </div>
  <div class="summary-item">
    <div class="summary-value">${totalCalls}</div>
    <div>Tool Calls</div>
  </div>
  <div class="summary-item">
    <div class="summary-value">${totalErrors}</div>
    <div>Errors</div>
  </div>
  <div class="summary-item">
    <div class="summary-value">${avgLatency}ms</div>
    <div>Avg Latency</div>
  </div>
</div>`;
  }

  private renderServers(servers: { id: string; command?: string; url?: string; type: string; enabled?: boolean }[], metrics: McpServerMetrics[]): string {
    if (servers.length === 0) {
      return '<p>No MCP servers configured.</p>';
    }

    return servers.map(srv => {
      const status = this.manager.getServerStatus(srv.id);
      const metric = metrics.find(m => m.serverId === srv.id);
      const statusClass = `status-${status.status}`;
      const label = srv.command || srv.url || srv.id;

      return `
<div class="server-card">
  <div class="server-header">
    <span class="server-name">${this.escapeHtml(srv.id)}</span>
    <span>
      <span class="status-badge ${statusClass}">${status.status}</span>
    </span>
  </div>
  <div class="server-details">
    <table>
      <tr><td>Command:</td><td>${this.escapeHtml(label)}</td></tr>
      ${metric ? `
      <tr><td>Tool calls:</td><td>${metric.totalToolCalls} (${metric.failedToolCalls} failed)</td></tr>
      <tr><td>Avg latency:</td><td>${metric.avgLatencyMs}ms</td></tr>
      <tr><td>Errors:</td><td>${metric.errorCount}</td></tr>
      ` : ''}
      ${status.config?.args?.length ? `<tr><td>Args:</td><td>${this.escapeHtml(status.config.args.join(' '))}</td></tr>` : ''}
    </table>
  </div>
  <div style="margin-top: 6px; display: flex; gap: 4px;">
    <button class="btn" onclick="postMsg('restart', '${srv.id}')">Restart</button>
    <button class="btn btn-secondary" onclick="postMsg('disconnect', '${srv.id}')">Disconnect</button>
  </div>
</div>`;
    }).join('\n');
  }

  private renderTraces(traces: string[]): string {
    if (traces.length === 0) {
      return '<p class="trace-log">No trace entries yet.</p>';
    }
    return `<div class="trace-log">${traces.map(t => this.escapeHtml(t)).join('\n')}</div>`;
  }

  private renderHistory(history: { serverId: string; status: ServiceStatus; lastError: string | null }[]): string {
    if (history.length === 0) {
      return '<p>No events yet.</p>';
    }
    return history.map(h => {
      const statusClass = `status-${h.status}`;
      return `<div class="history-item">
        <span class="status-badge ${statusClass}" style="font-size:10px">${h.status}</span>
        <strong>${this.escapeHtml(h.serverId)}</strong>
        ${h.lastError ? `— ${this.escapeHtml(h.lastError)}` : ''}
      </div>`;
    }).join('\n');
  }

  private postMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }
}
