import { Tool, ToolResult } from '../models/tool';

/**
 * Service status enum for MCP server lifecycle.
 */
export enum ServiceStatus {
  Stopped = 'stopped',
  Starting = 'starting',
  Running = 'running',
  Retrying = 'retrying',
  Failed = 'failed',
}

/**
 * Event emitted when a server's status changes.
 */
export interface McpServerStatusEvent {
  serverId: string;
  status: ServiceStatus;
  previousStatus: ServiceStatus;
  uptime: number;
  lastError: string | null;
  toolCount: number;
  latency: number | null;
}

/**
 * MCP Manager configuration.
 */
export interface McpManagerConfig {
  healthCheckIntervalMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  autoStart: boolean;
}

export const DEFAULT_MCP_MANAGER_CONFIG: McpManagerConfig = {
  healthCheckIntervalMs: 30000,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 1000,
  autoStart: true,
};

export interface IMcpClient {
  // Server management
  connect(serverConfig: McpServerConfig): Promise<void>;
  disconnect(serverId?: string): Promise<void>;
  isConnected(): boolean;
  listServers(): McpServerInfo[];

  // Tool discovery
  listTools(): Promise<Tool[]>;
  listToolsForServer(serverId: string): Promise<Tool[]>;
  getTool(name: string): Promise<Tool | undefined>;

  // Tool execution
  callTool(name: string, params: unknown): Promise<ToolResult>;

  // Introspection / meta
  getConfig(): McpServerConfig[];
  getStatus(): McpServerStatus[];
  reloadConfig(configProvider: () => Promise<McpServerConfig[]>): Promise<void>;

  // Event handling
  onToolCall(listener: (call: ToolCall) => void): void;
  onServerError(listener: (error: Error) => void): void;

  // Lifecycle (added in refactor)
  getServerConnection?(serverId: string): { status: ServiceStatus; restart(): Promise<void> } | undefined;
  onStatusChange?(listener: (event: McpServerStatusEvent) => void): void;
}

export interface McpServerStatus {
  id: string;
  connected: boolean;
  uptime: number;
  lastError: string | null;
  toolCount: number;
  latency: number | null;
}

export interface McpServerConfig {
  id: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export interface McpServerInfo {
  id: string;
  name: string;
  version: string;
  tools: number;
  connected: boolean;
}

// Re-export for convenience
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export const IMcpClient = Symbol('IMcpClient');
