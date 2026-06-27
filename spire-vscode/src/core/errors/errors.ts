export class SpireError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SpireError';
  }
}

export class ProviderError extends SpireError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

export class ToolError extends SpireError {
  constructor(message: string) {
    super(message, 'TOOL_ERROR');
    this.name = 'ToolError';
  }
}

export class MCPError extends SpireError {
  constructor(message: string) {
    super(message, 'MCP_ERROR');
    this.name = 'MCPError';
  }
}

export class WorkflowError extends SpireError {
  constructor(message: string) {
    super(message, 'WORKFLOW_ERROR');
    this.name = 'WorkflowError';
  }
}
