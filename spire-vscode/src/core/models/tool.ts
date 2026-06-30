export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(params: unknown): Promise<string>;
}

export interface ToolResult {
  content: string;
  success: boolean;
  error?: string;
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, {
    type?: string;
    description?: string;
    enum?: string[];
    items?: any;
  }>;
  required?: string[];
}
