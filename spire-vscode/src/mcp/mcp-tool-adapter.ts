import { IMcpClient } from '../core/interfaces/mcp-client';
import { IToolRegistry } from '../core/interfaces/tool-registry';
import { Tool, ToolResult, JSONSchema } from '../core/models/tool';
import { MCPError } from '../core/errors/errors';

/**
 * Adapts MCP client tools into the local ToolRegistry.
 * This bridges the gap between MCP-discovered tools and
 * the local tool execution pipeline used by workflows.
 */
export class McpToolAdapter {
  private mcpClient: IMcpClient;
  private toolRegistry: IToolRegistry;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(mcpClient: IMcpClient, toolRegistry: IToolRegistry) {
    this.mcpClient = mcpClient;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Sync all MCP tools into the local registry once.
   */
  async syncTools(): Promise<number> {
    let syncedCount = 0;
    try {
      const mcpTools = await this.mcpClient.listTools();
      for (const mcpTool of mcpTools) {
        this.toolRegistry.register(this.adaptTool(mcpTool));
        syncedCount++;
      }
    } catch (error) {
      throw new MCPError(`Failed to sync MCP tools: ${(error as Error).message}`);
    }
    return syncedCount;
  }

  /**
   * Start periodic sync of MCP tools.
   */
  startAutoSync(intervalMs: number = 30000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    this.syncInterval = setInterval(() => {
      this.syncTools().catch(err => {
        console.error('[McpToolAdapter] Auto-sync failed:', err.message);
      });
    }, intervalMs);
  }

  /**
   * Stop periodic sync.
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Adapt an MCP Tool to the local Tool interface.
   * The adapted tool's execute method delegates to the MCP client.
   */
  private adaptTool(mcpTool: Tool): Tool {
    return {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: mcpTool.parameters as JSONSchema,
      execute: async (params: unknown): Promise<string> => {
        const result = await this.mcpClient.callTool(mcpTool.name, params);
        return result.content;
      }
    };
  }
}
