import { ServiceStatus } from '../core/interfaces/mcp-client';
import { McpManager } from '../mcp/mcp-manager';
import { McpObservability, McpServerMetrics } from '../monitoring/mcp-observability';

export function getMcpHtml(manager: McpManager, observability: McpObservability): string {
  const servers = manager.listConfiguredServers();
  const metrics = observability.getAllMetrics();
  const traces = observability.getTraces(20);
  const statusHistory = observability.getStatusHistory(10);

  return `
  <div class="mcp-toolbar">
    <button class="mcp-btn" onclick="postMsg('mcp.refresh')">⟳ Refresh</button>
  </div>

  <h2>MCP Servers</h2>
  <div id="mcp-summary">${renderSummary(metrics)}</div>
  <div id="mcp-servers">${renderServers(manager, servers, metrics)}</div>

  <h3>Recent Events</h3>
  <div id="mcp-history">${renderHistory(statusHistory)}</div>

  <h3>Trace Log</h3>
  <div id="mcp-traces">${renderTraces(traces)}</div>
  `;
}

function renderSummary(metrics: McpServerMetrics[]): string {
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

function renderServers(manager: McpManager, servers: { id: string; command?: string; url?: string; type: string; enabled?: boolean }[], metrics: McpServerMetrics[]): string {
  if (servers.length === 0) {
    return '<p>No MCP servers configured.</p>';
  }

  return servers.map(srv => {
    const status = manager.getServerStatus(srv.id);
    const metric = metrics.find(m => m.serverId === srv.id);
    const statusClass = `status-${status.status}`;
    const label = srv.command || srv.url || srv.id;

    return `
<div class="server-card">
<div class="server-header">
  <span class="server-name">${escapeHtml(srv.id)}</span>
  <span>
    <span class="status-badge ${statusClass}">${status.status}</span>
  </span>
</div>
<div class="server-details">
  <table>
    <tr><td>Command:</td><td>${escapeHtml(label)}</td></tr>
    ${metric ? `
    <tr><td>Tool calls:</td><td>${metric.totalToolCalls} (${metric.failedToolCalls} failed)</td></tr>
    <tr><td>Avg latency:</td><td>${metric.avgLatencyMs}ms</td></tr>
    <tr><td>Errors:</td><td>${metric.errorCount}</td></tr>
    ` : ''}
    ${status.config?.args?.length ? `<tr><td>Args:</td><td>${escapeHtml(status.config.args.join(' '))}</td></tr>` : ''}
  </table>
</div>
<div style="margin-top: 6px; display: flex; gap: 4px;">
  <button class="mcp-btn" onclick="postMsg('mcp.restart', '${srv.id}')">Restart</button>
  <button class="mcp-btn btn-secondary" onclick="postMsg('mcp.disconnect', '${srv.id}')">Disconnect</button>
</div>
</div>`;
  }).join('\n');
}

function renderTraces(traces: string[]): string {
  if (traces.length === 0) {
    return '<p class="trace-log">No trace entries yet.</p>';
  }
  return `<div class="trace-log">${traces.map(t => escapeHtml(t)).join('\n')}</div>`;
}

function renderHistory(history: { serverId: string; status: ServiceStatus; lastError: string | null }[]): string {
  if (history.length === 0) {
    return '<p>No events yet.</p>';
  }
  return history.map(h => {
    const statusClass = `status-${h.status}`;
    return `<div class="history-item">
      <span class="status-badge ${statusClass}" style="font-size:10px">${h.status}</span>
      <strong>${escapeHtml(h.serverId)}</strong>
      ${h.lastError ? `— ${escapeHtml(h.lastError)}` : ''}
    </div>`;
  }).join('\n');
}

export function getMcpCss(): string {
  return `
  .mcp-container h2 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; }
  .mcp-container h3 { margin: 12px 0 6px 0; font-size: 13px; font-weight: 600; }
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
  .mcp-btn {
    cursor: pointer;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 11px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .mcp-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .mcp-btn.btn-secondary {
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
  .mcp-toolbar {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '\x26amp;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;')
    .replace(/"/g, '\x26quot;');
}