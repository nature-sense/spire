import { IToolRegistry } from '../core/interfaces/tool-registry';
import { Tool, ToolResult } from '../core/models/tool';
import { ToolError } from '../core/errors/errors';

export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerBatch(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, params: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: '',
        success: false,
        error: `Tool "${name}" not found in registry`
      };
    }

    try {
      const content = await tool.execute(params);
      return { content, success: true };
    } catch (error) {
      return {
        content: '',
        success: false,
        error: `Tool "${name}" execution failed: ${(error as Error).message}`
      };
    }
  }
}
