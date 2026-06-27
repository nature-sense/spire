import { Tool, ToolResult } from '../models/tool';

export interface IToolRegistry {
  register(tool: Tool): void;
  registerBatch(tools: Tool[]): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  execute(name: string, params: unknown): Promise<ToolResult>;
  has(name: string): boolean;
}

export const IToolRegistry = Symbol('IToolRegistry');
