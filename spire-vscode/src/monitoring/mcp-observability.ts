import { McpServerStatusEvent, ServiceStatus } from '../core/interfaces/mcp-client';

/**
 * Configuration for MCP observability.
 */
export interface McpObservabilityConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxMetricsHistory: number;
}

const DEFAULT_CONFIG: McpObservabilityConfig = {
  enabled: true,
  logLevel: 'info',
  maxMetricsHistory: 1000,
};

/**
 * Collected metric for an MCP server.
 */
export interface McpServerMetrics {
  serverId: string;
  totalToolCalls: number;
  failedToolCalls: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  errorCount: number;
  statusChanges: number;
  lastStatus: ServiceStatus;
  lastError: string | null;
  lastActivity: string; // ISO timestamp
}

/**
 * Observability for MCP servers — structured logging, metrics collection.
 *
 * Emits events that the health service + status bar + dashboard can consume.
 */
export class McpObservability {
  private config: McpObservabilityConfig;
  private metrics: Map<string, McpServerMetrics> = new Map();
  private statusHistory: McpServerStatusEvent[] = [];
  private traceLog: string[] = [];
  private traceLimit: number;

  /** Listeners for metric updates */
  private onMetricsListeners: Array<(metrics: McpServerMetrics[]) => void> = [];

  constructor(config?: Partial<McpObservabilityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.traceLimit = this.config.maxMetricsHistory;
  }

  // ── Status change tracking ──────────────────────────────────────

  /** Record a status change event (called by the manager or health service) */
  recordStatusChange(event: McpServerStatusEvent): void {
    this.statusHistory.push(event);
    if (this.statusHistory.length > this.traceLimit) {
      this.statusHistory.shift();
    }

    let m = this.metrics.get(event.serverId);
    if (!m) {
      m = this.createMetrics(event.serverId);
      this.metrics.set(event.serverId, m);
    }
    m.statusChanges++;
    m.lastStatus = event.status;
    m.lastError = event.lastError;
    m.lastActivity = new Date().toISOString();

    if (event.status === ServiceStatus.Failed || event.status === ServiceStatus.Retrying) {
      this.log('warn', `Server="${event.serverId}" status=${event.status} error="${event.lastError || 'unknown'}"`);
    } else if (event.status === ServiceStatus.Running) {
      this.log('info', `Server="${event.serverId}" status=running uptime=${event.uptime}s tools=${event.toolCount}`);
    }

    this.emitMetrics();
  }

  // ── Tool-call tracking ──────────────────────────────────────────

  /** Record a tool call result (call from McpClient or manager) */
  recordToolCall(serverId: string, toolName: string, durationMs: number, success: boolean, error?: string): void {
    let m = this.metrics.get(serverId);
    if (!m) {
      m = this.createMetrics(serverId);
      this.metrics.set(serverId, m);
    }

    m.totalToolCalls++;
    m.totalLatencyMs += durationMs;
    m.avgLatencyMs = Math.round(m.totalLatencyMs / m.totalToolCalls);
    m.lastActivity = new Date().toISOString();

    if (!success) {
      m.failedToolCalls++;
      m.errorCount++;
      m.lastError = error || 'unknown';
      this.log('warn', `ToolCall server="${serverId}" tool="${toolName}" failed="${error}"`);
    } else {
      const level = this.config.logLevel === 'debug' ? 'debug' : 'info';
      if (level === 'debug') {
        this.log('debug', `ToolCall server="${serverId}" tool="${toolName}" ok=${durationMs}ms`);
      }
    }

    // Only emit metrics on tool call if there are listeners
    if (this.onMetricsListeners.length > 0) {
      this.emitMetrics();
    }
  }

  // ── Trace logging ───────────────────────────────────────────────

  /** Append a general trace line */
  trace(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.traceLog.push(line);
    if (this.traceLog.length > this.traceLimit) {
      this.traceLog.shift();
    }
    this.log('debug', message);
  }

  /** Get recent trace lines */
  getTraces(count: number = 50): string[] {
    return this.traceLog.slice(-count);
  }

  // ── Metrics queries ─────────────────────────────────────────────

  /** Get current metrics for all servers */
  getAllMetrics(): McpServerMetrics[] {
    return Array.from(this.metrics.values());
  }

  /** Get metrics for a specific server */
  getServerMetrics(serverId: string): McpServerMetrics | undefined {
    return this.metrics.get(serverId);
  }

  /** Get status change history (most recent first) */
  getStatusHistory(count: number = 20): McpServerStatusEvent[] {
    return this.statusHistory.slice(-count).reverse();
  }

  /** Get aggregate error count across all servers */
  getTotalErrorCount(): number {
    let total = 0;
    for (const m of this.metrics.values()) {
      total += m.errorCount;
    }
    return total;
  }

  /** Get total tool calls across all servers */
  getTotalToolCalls(): number {
    let total = 0;
    for (const m of this.metrics.values()) {
      total += m.totalToolCalls;
    }
    return total;
  }

  // ── Event subscription ──────────────────────────────────────────

  /** Subscribe to metric updates */
  onMetricsUpdated(listener: (metrics: McpServerMetrics[]) => void): void {
    this.onMetricsListeners.push(listener);
  }

  /** Unsubscribe from metric updates */
  offMetricsUpdated(listener: (metrics: McpServerMetrics[]) => void): void {
    this.onMetricsListeners = this.onMetricsListeners.filter(l => l !== listener);
  }

  /** Reset all metrics for a server */
  resetServerMetrics(serverId: string): void {
    this.metrics.delete(serverId);
    this.emitMetrics();
    this.trace(`Metrics reset for server="${serverId}"`);
  }

  /** Reset all metrics */
  resetAll(): void {
    this.metrics.clear();
    this.statusHistory = [];
    this.emitMetrics();
    this.trace('All metrics reset');
  }

  // ── Internal ────────────────────────────────────────────────────

  private createMetrics(serverId: string): McpServerMetrics {
    return {
      serverId,
      totalToolCalls: 0,
      failedToolCalls: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      errorCount: 0,
      statusChanges: 0,
      lastStatus: ServiceStatus.Stopped,
      lastError: null,
      lastActivity: new Date().toISOString(),
    };
  }

  private emitMetrics(): void {
    const snapshot = this.getAllMetrics();
    for (const listener of this.onMetricsListeners) {
      try {
        listener(snapshot);
      } catch {
        // Don't let a bad listener break observability
      }
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (!this.config.enabled) return;

    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] < levels[this.config.logLevel]) return;

    const prefix = `[Spire:MCP]`;
    switch (level) {
      case 'debug':
        console.debug(`${prefix} ${message}`);
        break;
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
    }
  }
}
