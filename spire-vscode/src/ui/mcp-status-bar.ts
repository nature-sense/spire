import * as vscode from 'vscode';
import { ServiceStatus, McpServerStatusEvent } from '../core/interfaces/mcp-client';
import { McpObservability, McpServerMetrics } from '../monitoring/mcp-observability';

/**
 * Status bar item that shows aggregate MCP health.
 *
 * - Green $(circuit-board) = All servers running
 * - Yellow $(alert) = Some servers degraded / starting
 * - Red $(error) = All servers failed
 * - Grey $(circle-slash) = No MCP servers configured
 *
 * Click opens the MCP Dashboard.
 */
export class McpStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private observability: McpObservability;
  private showDashboard: () => void;

  private serverStatuses: Map<string, ServiceStatus> = new Map();

  constructor(observability: McpObservability, showDashboard: () => void) {
    this.observability = observability;
    this.showDashboard = showDashboard;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100  // Priority — before the language mode indicator
    );
    this.statusBarItem.command = 'spire.showMCPDashboard';
    this.statusBarItem.tooltip = 'MCP Servers — click to open dashboard';
    this.statusBarItem.text = '$(circuit-board) MCP';
    this.statusBarItem.show();
  }

  /** Handle a status change event from the manager */
  updateFromStatusEvent(event: McpServerStatusEvent): void {
    this.serverStatuses.set(event.serverId, event.status);
    this.refreshDisplay();
  }

  /** Remove a server from the status bar */
  removeServer(serverId: string): void {
    this.serverStatuses.delete(serverId);
    this.refreshDisplay();
  }

  /** Clear all server statuses */
  clear(): void {
    this.serverStatuses.clear();
    this.refreshDisplay();
  }

  /** Refresh the display based on current statuses */
  private refreshDisplay(): void {
    const statuses = Array.from(this.serverStatuses.values());

    if (statuses.length === 0) {
      this.statusBarItem.text = '$(circle-slash) MCP';
      this.statusBarItem.tooltip = 'No MCP servers configured';
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

    const hasRunning = statuses.some(s => s === ServiceStatus.Running);
    const hasStarting = statuses.some(s => s === ServiceStatus.Starting || s === ServiceStatus.Retrying);
    const hasFailed = statuses.some(s => s === ServiceStatus.Failed);

    if (hasFailed && !hasRunning) {
      // All servers failed
      this.statusBarItem.text = `$(error) MCP`;
      this.statusBarItem.tooltip = 'MCP servers: all failed — click for details';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (hasStarting || hasFailed) {
      // Some degraded
      const running = statuses.filter(s => s === ServiceStatus.Running).length;
      const total = statuses.length;
      this.statusBarItem.text = `$(alert) MCP ${running}/${total}`;
      this.statusBarItem.tooltip = `MCP servers: ${running}/${total} running — click for details`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      // All running
      this.statusBarItem.text = `$(circuit-board) MCP ${statuses.length}`;
      this.statusBarItem.tooltip = `MCP servers: all ${statuses.length} running`;
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  /** Update metrics display (adds metrics info to tooltip) */
  updateMetrics(metrics: McpServerMetrics[]): void {
    if (metrics.length === 0) return;

    const totalCalls = metrics.reduce((sum, m) => sum + m.totalToolCalls, 0);
    const totalErrors = metrics.reduce((sum, m) => sum + m.errorCount, 0);
    const currentTooltip = this.statusBarItem.tooltip || '';

    if (totalErrors > 0) {
      this.statusBarItem.tooltip = `${currentTooltip}\nCalls: ${totalCalls} | Errors: ${totalErrors}`;
    }
  }

  /** Dispose the status bar item */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
