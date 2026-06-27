import { IMcpClient, McpServerConfig, ServiceStatus, McpServerStatusEvent, DEFAULT_MCP_MANAGER_CONFIG, McpManagerConfig } from '../core/interfaces/mcp-client';
import { McpClient } from './mcp-client';
import { McpToolAdapter } from './mcp-tool-adapter';
import { McpObservability } from '../monitoring/mcp-observability';
import { HealthService } from '../monitoring/health-service';
import { IToolRegistry } from '../core/interfaces/tool-registry';

/**
 * MCP Manager — centralized lifecycle for all MCP servers.
 *
 * Wraps McpClient, adds:
 * - Status change events → observability
 * - Auto-restart with backoff for failed servers
 * - Connection to health service
 * - Clean shutdown
 */
export class McpManager {
  private mcpClient: McpClient;
  private observability: McpObservability;
  private healthService: HealthService;
  private mcpToolAdapter: McpToolAdapter | null = null;
  private config: McpManagerConfig;
  private started = false;

  /** Per-server retry state */
  private retryState: Map<string, { attempts: number; timer: ReturnType<typeof setTimeout> | null }> = new Map();

  /** Per-server latest config (for retry) */
  private serverConfigs: Map<string, McpServerConfig> = new Map();

  constructor(
    mcpClient: McpClient,
    toolRegistry: IToolRegistry,
    observability: McpObservability,
    config?: Partial<McpManagerConfig>,
  ) {
    this.mcpClient = mcpClient;
    this.observability = observability;
    this.config = { ...DEFAULT_MCP_MANAGER_CONFIG, ...config };
    this.healthService = new HealthService(mcpClient, observability, {
      checkIntervalMs: this.config.healthCheckIntervalMs,
      retryMaxAttempts: this.config.retryMaxAttempts,
      retryBaseDelayMs: this.config.retryBaseDelayMs,
    });
    this.mcpToolAdapter = new McpToolAdapter(mcpClient, toolRegistry);

    // Wire status events → observability
    this.mcpClient.onStatusChange((event: McpServerStatusEvent) => {
      this.observability.recordStatusChange(event);

      // Auto-retry if a server failed and we haven't exhausted retries
      if (event.status === ServiceStatus.Failed && this.started) {
        this.scheduleRetry(event.serverId);
      }

      // Reset failure count on successful start
      if (event.status === ServiceStatus.Running) {
        this.retryState.delete(event.serverId);
        this.healthService.resetFailures(event.serverId);
      }
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Connect all servers from config and start monitoring */
  async start(servers: McpServerConfig[]): Promise<void> {
    this.started = true;

    // Store configs for retry
    for (const srv of servers) {
      this.serverConfigs.set(srv.id, srv);
    }

    // Connect to each enabled server
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const serverConfig of servers) {
      if (serverConfig.enabled !== false) {
        try {
          await this.mcpClient.connect(serverConfig);
          results.push({ id: serverConfig.id, success: true });
        } catch (err) {
          results.push({ id: serverConfig.id, success: false, error: (err as Error).message });
          // Retry will be triggered by the status change event
        }
      }
    }

    // Sync MCP tools into the tool registry
    if (this.mcpToolAdapter) {
      try {
        const syncedCount = await this.mcpToolAdapter.syncTools();
        this.observability.trace(`Synced ${syncedCount} MCP tools`);
      } catch (err) {
        this.observability.trace(`Tool sync failed: ${(err as Error).message}`);
      }
    }

    // Start health checks
    this.healthService.start();

    this.observability.trace(
      `MCP Manager started: ${results.filter(r => r.success).length}/${results.length} servers connected`
    );
  }

  /** Stop all servers and health checks */
  async stop(): Promise<void> {
    this.started = false;

    // Cancel any pending retries
    for (const [, state] of this.retryState) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.retryState.clear();

    this.healthService.stop();

    if (this.mcpToolAdapter) {
      this.mcpToolAdapter.stopAutoSync();
    }

    await this.mcpClient.disconnect();
    this.observability.trace('MCP Manager stopped');
  }

  // ── Server-level operations ─────────────────────────────────────

  /** Connect a single server by config */
  async connectServer(config: McpServerConfig): Promise<void> {
    this.serverConfigs.set(config.id, config);
    await this.mcpClient.connect(config);
  }

  /** Disconnect a single server */
  async disconnectServer(serverId: string): Promise<void> {
    this.serverConfigs.delete(serverId);
    this.cancelRetry(serverId);
    this.healthService.resetFailures(serverId);
    await this.mcpClient.disconnect(serverId);
  }

  /** Restart a single server */
  async restartServer(serverId: string): Promise<void> {
    const config = this.serverConfigs.get(serverId);
    if (!config) {
      throw new Error(`No config found for server "${serverId}"`);
    }
    this.cancelRetry(serverId);
    this.healthService.resetFailures(serverId);
    this.observability.trace(`Restarting server="${serverId}"`);
    await this.mcpClient.disconnect(serverId);
    await this.mcpClient.connect(config);
  }

  /** Reload config from a provider function */
  async reloadConfig(configProvider: () => Promise<McpServerConfig[]>): Promise<void> {
    // Cancel all retries
    for (const [, state] of this.retryState) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.retryState.clear();

    await this.mcpClient.reloadConfig(configProvider);

    // Re-populate server configs
    this.serverConfigs.clear();
    const newConfigs = await configProvider();
    for (const srv of newConfigs) {
      if (srv.enabled !== false) {
        this.serverConfigs.set(srv.id, srv);
      }
    }

    // Re-sync tools
    if (this.mcpToolAdapter) {
      try {
        const syncedCount = await this.mcpToolAdapter.syncTools();
        this.observability.trace(`Re-synced ${syncedCount} MCP tools after config reload`);
      } catch (err) {
        this.observability.trace(`Tool re-sync failed: ${(err as Error).message}`);
      }
    }
  }

  // ── Accessors ───────────────────────────────────────────────────

  getClient(): McpClient {
    return this.mcpClient;
  }

  getObservability(): McpObservability {
    return this.observability;
  }

  getHealthService(): HealthService {
    return this.healthService;
  }

  getToolAdapter(): McpToolAdapter | null {
    return this.mcpToolAdapter;
  }

  getServerStatus(serverId: string): { status: ServiceStatus; config: McpServerConfig | undefined } {
    const connection = this.mcpClient.getServerConnection?.(serverId);
    return {
      status: connection?.status ?? ServiceStatus.Stopped,
      config: this.serverConfigs.get(serverId),
    };
  }

  listConfiguredServers(): McpServerConfig[] {
    return Array.from(this.serverConfigs.values());
  }

  isRunning(): boolean {
    return this.started;
  }

  // ── Retry logic ─────────────────────────────────────────────────

  private scheduleRetry(serverId: string): void {
    let state = this.retryState.get(serverId);
    if (!state) {
      state = { attempts: 0, timer: null };
      this.retryState.set(serverId, state);
    }

    state.attempts++;
    if (state.attempts > this.config.retryMaxAttempts) {
      this.observability.trace(
        `Server="${serverId}" exhausted ${this.config.retryMaxAttempts} retries`
      );
      return;
    }

    // Exponential backoff: baseDelay * 2^(attempts-1)
    const delay = this.config.retryBaseDelayMs * Math.pow(2, state.attempts - 1);
    this.observability.trace(
      `Scheduling retry ${state.attempts}/${this.config.retryMaxAttempts} for server="${serverId}" in ${delay}ms`
    );

    state.timer = setTimeout(async () => {
      const config = this.serverConfigs.get(serverId);
      if (!config) return;

      const prevStatus = this.mcpClient.getServerConnection?.(serverId)?.status ?? ServiceStatus.Stopped;
      if (prevStatus === ServiceStatus.Running) return; // Already running, skip

      // Emit retrying status via the connection
      try {
        // Pass config via temp disconnect+connect
        this.observability.trace(`Retrying server="${serverId}" (attempt ${state!.attempts})`);
        await this.mcpClient.connect(config);
      } catch (err) {
        this.observability.trace(`Retry failed for server="${serverId}": ${(err as Error).message}`);
        // The status change from the failed connect will trigger another retry
      }
    }, delay);
  }

  private cancelRetry(serverId: string): void {
    const state = this.retryState.get(serverId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.retryState.delete(serverId);
  }
}
