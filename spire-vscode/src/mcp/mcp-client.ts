import { ChildProcess, spawn } from 'child_process';
import { IMcpClient, McpServerConfig, McpServerInfo, McpServerStatus, ServiceStatus, McpServerStatusEvent } from '../core/interfaces/mcp-client';
import { Tool, ToolResult } from '../core/models/tool';
import { MCPError } from '../core/errors/errors';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export class McpClient implements IMcpClient {
  private servers: Map<string, McpServerConnection> = new Map();
  private onToolCallListeners: Array<(call: any) => void> = [];
  private onErrorListeners: Array<(error: Error) => void> = [];
  private onStatusChangeListeners: Array<(event: McpServerStatusEvent) => void> = [];
  private requestId = 1;

  async connect(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) {
      await this.disconnect(config.id);
    }

    const connection = new McpServerConnection(config);
    connection.onError((err) => {
      this.onErrorListeners.forEach(l => l(err));
    });
    connection.onStatusChange((event) => {
      this.onStatusChangeListeners.forEach(l => l(event));
    });

    // Add to servers map BEFORE start() so it always appears in listings
    // (status will be Starting then Running or Failed)
    this.servers.set(config.id, connection);

    try {
      await connection.start();
    } catch (err) {
      // Connection failed but remains in the servers map with Failed status
      console.error(`[McpClient] Failed to connect server "${config.id}":`, (err as Error).message);
      // Don't re-throw — the failed connection is preserved in the map
    }
  }

  async disconnect(serverId?: string): Promise<void> {
    if (serverId) {
      const conn = this.servers.get(serverId);
      if (conn) {
        conn.stop();
        this.servers.delete(serverId);
      }
    } else {
      for (const [id, conn] of this.servers) {
        conn.stop();
      }
      this.servers.clear();
    }
  }

  isConnected(): boolean {
    for (const conn of this.servers.values()) {
      if (conn.connected) return true;
    }
    return false;
  }

  listServers(): McpServerInfo[] {
    const infos: McpServerInfo[] = [];
    for (const [id, conn] of this.servers) {
      infos.push({
        id,
        name: conn.config.command || conn.config.url || id,
        version: '1.0',
        tools: 0,
        connected: conn.connected
      });
    }
    return infos;
  }

  async listTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];
    for (const [id, conn] of this.servers) {
      if (!conn.connected) continue;
      try {
        const tools = await conn.listTools();
        allTools.push(...tools);
      } catch (err) {
        this.onErrorListeners.forEach(l => l(new MCPError(`Failed to list tools from ${id}: ${(err as Error).message}`)));
      }
    }
    return allTools;
  }

  async getTool(name: string): Promise<Tool | undefined> {
    const tools = await this.listTools();
    return tools.find(t => t.name === name);
  }

  async callTool(name: string, params: unknown): Promise<ToolResult> {
    for (const [id, conn] of this.servers) {
      if (!conn.connected) continue;
      try {
        const tools = await conn.listTools();
        if (tools.some(t => t.name === name)) {
          return await conn.callTool(name, params);
        }
      } catch {
        // Try next server
      }
    }
    return {
      content: '',
      success: false,
      error: `Tool "${name}" not found on any connected server`
    };
  }

  onToolCall(listener: (call: any) => void): void {
    this.onToolCallListeners.push(listener);
  }

  onServerError(listener: (error: Error) => void): void {
    this.onErrorListeners.push(listener);
  }

  // ── New lifecycle/observability methods ──────────────────────────

  /** Subscribe to status change events */
  onStatusChange(listener: (event: McpServerStatusEvent) => void): void {
    this.onStatusChangeListeners.push(listener);
  }

  /** Get the internal connection for a server (for manager use) */
  getServerConnection(serverId: string): { status: ServiceStatus; restart(): Promise<void> } | undefined {
    const conn = this.servers.get(serverId);
    if (!conn) return undefined;
    return {
      status: conn.status,
      restart: async () => {
        if (conn.config) {
          await this.disconnect(serverId);
          await this.connect(conn.config);
        }
      },
    };
  }

  // --- Introspection methods ---

  getConfig(): McpServerConfig[] {
    const result: McpServerConfig[] = [];
    for (const [id, conn] of this.servers) {
      result.push({
        ...conn.config,
        id
      });
    }
    return result;
  }

  getStatus(): McpServerStatus[] {
    const result: McpServerStatus[] = [];
    for (const [id, conn] of this.servers) {
      result.push({
        id,
        connected: conn.connected,
        uptime: conn.uptime,
        lastError: conn.lastError,
        toolCount: conn.toolCount,
        latency: conn.latency
      });
    }
    return result;
  }

  async listToolsForServer(serverId: string): Promise<Tool[]> {
    const conn = this.servers.get(serverId);
    if (!conn || !conn.connected) return [];
    return conn.listTools();
  }

  async reloadConfig(configProvider: () => Promise<McpServerConfig[]>): Promise<void> {
    // Disconnect all current servers
    await this.disconnect();

    // Load new config from provider
    const newConfigs = await configProvider();

    // Connect to all enabled servers
    for (const cfg of newConfigs) {
      if (cfg.enabled !== false) {
        try {
          await this.connect(cfg);
        } catch (err) {
          this.onErrorListeners.forEach(l =>
            l(new MCPError(`Failed to connect to "${cfg.id}": ${(err as Error).message}`))
          );
        }
      }
    }
  }
}

class McpServerConnection {
  public connected = false;
  public status: ServiceStatus = ServiceStatus.Stopped;
  public uptime = 0;
  public lastError: string | null = null;
  public toolCount = 0;
  public latency: number | null = null;
  private startTime: number = 0;
  private process: ChildProcess | null = null;

  private buffer = '';
  private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map();
  private requestId = 1;
  private errorListeners: Array<(error: Error) => void> = [];
  private statusChangeListeners: Array<(event: McpServerStatusEvent) => void> = [];
  private readStream: NodeJS.ReadableStream | null = null;
  private writeStream: NodeJS.WritableStream | null = null;

  constructor(public config: McpServerConfig) {}

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }

  onStatusChange(listener: (event: McpServerStatusEvent) => void): void {
    this.statusChangeListeners.push(listener);
  }

  private emitStatusChange(previousStatus: ServiceStatus): void {
    this.uptime = this.connected && this.startTime > 0
      ? Math.floor((Date.now() - this.startTime) / 1000)
      : 0;
    const event: McpServerStatusEvent = {
      serverId: this.config.id,
      status: this.status,
      previousStatus,
      uptime: this.uptime,
      lastError: this.lastError,
      toolCount: this.toolCount,
      latency: this.latency,
    };
    this.statusChangeListeners.forEach(l => l(event));
  }

  async start(): Promise<void> {
    const prev = this.status;
    this.status = ServiceStatus.Starting;
    this.emitStatusChange(prev);

    if (this.config.type === 'stdio') {
      await this.startStdio();
    } else if (this.config.type === 'sse') {
      throw new MCPError('SSE transport not yet implemented');
    }
  }

  private async startStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...this.config.env };
      this.process = spawn(this.config.command!, this.config.args || [], {
        env,
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let initialized = false;
      let startupError: Error | null = null;

      this.process.stdout!.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr!.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) {
          console.error(`[MCP:${this.config.id}] ${line}`);
          // Capture first stderr line for diagnostics if not yet initialized
          if (!initialized && !startupError) {
            startupError = new MCPError(`Server stderr: ${line}`);
          }
        }
      });

      this.process.on('error', (err: NodeJS.ErrnoException) => {
        this.connected = false;
        const prev = this.status;
        this.status = ServiceStatus.Failed;
        // Provide a clear, actionable message for ENOENT
        if (err.code === 'ENOENT') {
          const msg = `Command not found: "${this.config.command}". ` +
            `This usually means the binary is not on the system PATH or is not installed. ` +
            `For the built-in filesystem server, Spire now uses VS Code's embedded Node.js. ` +
            `For custom servers, ensure the binary is installed (e.g., npm install -g <package>).`;
          const enhanced = new MCPError(msg);
          this.lastError = enhanced.message;
          this.emitStatusChange(prev);
          this.errorListeners.forEach(l => l(enhanced));
          reject(enhanced);
        } else {
          this.lastError = err.message;
          this.emitStatusChange(prev);
          this.errorListeners.forEach(l => l(err));
          reject(err);
        }
      });

      this.process.on('close', (code) => {
        this.connected = false;
        const prev = this.status;
        this.status = ServiceStatus.Failed;
        if (!initialized) {
          // Prefer the stderr-captured message if available
          const msg = startupError
            ? startupError.message
            : `Process exited with code ${code} before initialization completed`;
          this.lastError = msg;
          this.emitStatusChange(prev);
          reject(new MCPError(msg));
        } else {
          this.lastError = `Process exited with code ${code}`;
          this.emitStatusChange(prev);
        }
      });

      // Send initialize request (MCP spec requires clientInfo)
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'spire-vscode',
          version: '1.0.0'
        }
      }).then(() => {
        initialized = true;
        this.connected = true;
        this.startTime = Date.now();
        const prev = this.status;
        this.status = ServiceStatus.Running;
        this.emitStatusChange(prev);
        resolve();
      }).catch(reject);
    });
  }

  stop(): void {
    const prev = this.status;
    this.status = ServiceStatus.Stopped;
    this.connected = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new MCPError('Connection closed'));
    }
    this.pendingRequests.clear();
    this.emitStatusChange(prev);
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.sendRequest('tools/list', {});
    if (!result?.tools) return [];
    return result.tools.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
      execute: async (params: unknown) => {
        const res = await this.callTool(t.name, params);
        return res.content;
      }
    }));
  }

  async callTool(name: string, params: unknown): Promise<ToolResult> {
    try {
      const start = Date.now();
      const result = await this.sendRequest('tools/call', { name, arguments: params });
      this.latency = Date.now() - start;
      const textContent = result?.content?.[0]?.text || '';
      return { content: textContent, success: true };
    } catch (error) {
      this.lastError = (error as Error).message;
      return {
        content: '',
        success: false,
        error: (error as Error).message
      };
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg: JsonRpcMessage = JSON.parse(line);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new MCPError(msg.error.message));
          } else {
            pending.resolve(msg.result);
          }
        }
        // Handle notifications (no id)
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const msg: JsonRpcMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new MCPError(`Request timeout: ${method}`));
      }, 30000);

      // Wrap resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;
      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); originalResolve(v); },
        reject: (e) => { clearTimeout(timeout); originalReject(e); }
      });

      if (this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(msg) + '\n');
      } else {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new MCPError('No stdin available'));
      }
    });
  }
}

export default McpClient;
