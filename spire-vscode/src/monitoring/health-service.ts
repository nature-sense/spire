import { IMcpClient, McpServerStatus, ServiceStatus, McpServerStatusEvent } from '../core/interfaces/mcp-client';
import { McpObservability } from './mcp-observability';

/**
 * Configuration for the health service.
 */
export interface HealthServiceConfig {
  /** Interval between health checks (ms). Default 30s. */
  checkIntervalMs: number;
  /** Max consecutive failures before alerting. Default 3. */
  maxConsecutiveFailures: number;
  /** Number of retry attempts. Default 3. */
  retryMaxAttempts: number;
  /** Base delay for retry backoff (ms). Default 1s. */
  retryBaseDelayMs: number;
}

const DEFAULT_CONFIG: HealthServiceConfig = {
  checkIntervalMs: 30000,
  maxConsecutiveFailures: 3,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 1000,
};

/**
 * Health check result for a single server.
 */
export interface HealthResult {
  serverId: string;
  status: ServiceStatus;
  connected: boolean;
  toolCount: number;
  latency: number | null;
  lastError: string | null;
}

/**
 * Periodic health checks for MCP servers.
 *
 * Checks connectivity, latency, tool availability.
 * Reports results back to observability + enriches the status for the dashboard.
 */
export class HealthService {
  private config: HealthServiceConfig;
  private mcpClient: IMcpClient;
  private observability: McpObservability;
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures: Map<string, number> = new Map();

  /** Listeners for health check results */
  private onHealthListeners: Array<(results: HealthResult[]) => void> = [];

  constructor(
    mcpClient: IMcpClient,
    observability: McpObservability,
    config?: Partial<HealthServiceConfig>,
  ) {
    this.mcpClient = mcpClient;
    this.observability = observability;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start periodic health checks */
  start(): void {
    if (this.timer) return;
    this.observability.trace('HealthService started');
    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs);
    // Run an immediate check
    this.check();
  }

  /** Stop periodic health checks */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.observability.trace('HealthService stopped');
    }
  }

  /** Manually trigger a health check */
  async check(): Promise<HealthResult[]> {
    const results: HealthResult[] = [];
    const servers = this.mcpClient.listServers();

    for (const server of servers) {
      try {
        const statusList = this.mcpClient.getStatus();
        const stat = statusList.find(s => s.id === server.id);
        const connection = this.mcpClient.getServerConnection?.(server.id);

        let status = connection?.status ?? (server.connected ? ServiceStatus.Running : ServiceStatus.Failed);

        // Try to list tools as a health probe
        let toolCount = 0;
        let latency: number | null = null;
        if (server.connected) {
          const start = Date.now();
          const tools = await this.mcpClient.listToolsForServer(server.id);
          latency = Date.now() - start;
          toolCount = tools.length;

          // Reset failure count on success
          this.consecutiveFailures.set(server.id, 0);
        }

        const result: HealthResult = {
          serverId: server.id,
          status,
          connected: server.connected,
          toolCount: stat?.toolCount ?? toolCount,
          latency: stat?.latency ?? latency,
          lastError: stat?.lastError ?? null,
        };
        results.push(result);

        // Track consecutive failures for alerting
        if (!server.connected || status === ServiceStatus.Failed) {
          const failures = (this.consecutiveFailures.get(server.id) || 0) + 1;
          this.consecutiveFailures.set(server.id, failures);

          if (failures >= this.config.maxConsecutiveFailures) {
            this.observability.trace(
              `ALERT: Server="${server.id}" has ${failures} consecutive failures`
            );
          }
        }
      } catch (err) {
        const result: HealthResult = {
          serverId: server.id,
          status: ServiceStatus.Failed,
          connected: false,
          toolCount: 0,
          latency: null,
          lastError: (err as Error).message,
        };
        results.push(result);

        const failures = (this.consecutiveFailures.get(server.id) || 0) + 1;
        this.consecutiveFailures.set(server.id, failures);
        this.observability.trace(
          `HealthCheck server="${server.id}" failed="${(err as Error).message}"`
        );
      }
    }

    this.emitHealthResults(results);
    return results;
  }

  /** Get consecutive failure count for a server */
  getFailureCount(serverId: string): number {
    return this.consecutiveFailures.get(serverId) || 0;
  }

  /** Reset failure count for a server */
  resetFailures(serverId: string): void {
    this.consecutiveFailures.delete(serverId);
  }

  // ── Event subscription ──────────────────────────────────────────

  /** Subscribe to health check results */
  onHealthChecked(listener: (results: HealthResult[]) => void): void {
    this.onHealthListeners.push(listener);
  }

  /** Unsubscribe from health check results */
  offHealthChecked(listener: (results: HealthResult[]) => void): void {
    this.onHealthListeners = this.onHealthListeners.filter(l => l !== listener);
  }

  // ── Internal ────────────────────────────────────────────────────

  private emitHealthResults(results: HealthResult[]): void {
    for (const listener of this.onHealthListeners) {
      try {
        listener(results);
      } catch {
        // Don't let a bad listener break health checks
      }
    }
  }
}
