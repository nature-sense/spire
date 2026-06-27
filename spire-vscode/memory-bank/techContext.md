# Tech Context

## Technology Stack
- **Runtime:** Node.js (VS Code extension host)
- **Language:** TypeScript
- **Build:** tsc (TypeScript compiler) + vsce (VS Code extension packager)
- **LLM:** DeepSeek API (via REST/SSE)
- **MCP:** Model Context Protocol (JSON-RPC over stdio)
- **UI:** VS Code Webview API (sidebar)

## Project Structure
```
src/
├── extension.ts              # Extension entry point
├── config/
│   └── config.ts             # Spire configuration loader (VS Code settings)
├── context/
│   ├── memoryBank.ts         # Memory bank initialization
│   └── rules.ts              # Spire rules/instructions
├── core/
│   ├── errors/
│   │   └── errors.ts         # SpireError, MCPError, ToolError
│   ├── interfaces/
│   │   ├── llm-provider.ts   # ILLMProvider interface
│   │   ├── mcp-client.ts     # IMcpClient + McpServerConfig interfaces
│   │   ├── orchestrator.ts   # IOrchestrator + OrchestrationOptions
│   │   ├── tool-registry.ts  # IToolRegistry interface
│   │   └── workflow.ts       # IWorkflow interface
│   └── models/
│       ├── context.ts        # WorkspaceContext type
│       ├── message.ts        # Message/ChatMessage type
│       └── tool.ts           # Tool, ToolResult, ToolParameter types
├── llm/
│   ├── provider-factory.ts   # Factory to create LLM providers
│   └── deepseek/
│       └── deepseek-provider.ts  # DeepSeek API provider
├── mcp/
│   ├── mcp-client.ts         # MCP client (JSON-RPC stdio)
│   ├── mcp-config.ts         # MCP server config loader (.spire/mcp.json)
│   ├── mcp-manager.ts        # MCP lifecycle manager (health checks, retries)
│   └── mcp-tool-adapter.ts   # Sync MCP tools to registry
├── monitoring/
│   ├── health-service.ts     # Server health check service
│   └── mcp-observability.ts  # MCP observability/metrics
├── orchestration/
│   ├── orchestrator.ts       # Core orchestrator
│   ├── context-builder.ts    # Workspace context builder
│   └── workflows/
│       ├── agentic-workflow.ts  # Default agentic workflow
│       ├── direct.ts            # Simple direct LLM call
│       └── react.ts             # ReAct-style tool-use loop
├── tools/
│   ├── meta-tools.ts         # Spire self-awareness tools (MCP config, etc.)
│   └── tool-registry.ts      # Local tool registry
└── ui/
    ├── chat-html.ts          # HTML template for chat
    ├── chat-panel.ts         # Webview message handling
    ├── mcp-dashboard.ts      # MCP server dashboard webview
    ├── mcp-status-bar.ts     # MCP status bar indicator
    └── sidebar-provider.ts   # WebviewView provider
```

## MCP Architecture

Spire manages MCP servers via a **single file-based configuration** at `.spire/mcp.json` in the workspace root. There is no VS Code settings-based MCP configuration — everything lives in this file.

### Default Servers (auto-created on first launch)
When `.spire/mcp.json` does not exist, Spire auto-creates it with three standard servers:

1. **filesystem** — `@modelcontextprotocol/server-filesystem` (scoped to workspace root)
2. **terminal** — built-in `terminal-server.js` (shell command execution via Spire)
3. **github** — `@modelcontextprotocol/server-github` (requires `GITHUB_PERSONAL_ACCESS_TOKEN` env var)

All servers run via VS Code's embedded Node.js runtime (`ELECTRON_RUN_AS_NODE=1`) so they do not depend on a system-installed Node.js.

### Config File Format (`.spire/mcp.json`)
```json
{
  "servers": [
    {
      "id": "filesystem",
      "type": "stdio",
      "command": "/path/to/electron/node",
      "args": ["...server-filesystem/dist/index.js", "/workspace/root"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" },
      "enabled": true
    }
  ],
  "globalTimeout": 30000,
  "maxRetries": 3
}
```

### Key Components
- **`mcp-config.ts`** — Reads/writes `.spire/mcp.json`, auto-creates defaults, validates config
- **`mcp-client.ts`** — Low-level JSON-RPC stdio client for MCP protocol
- **`mcp-manager.ts`** — Lifecycle management: connect, health checks, retry with backoff, clean shutdown
- **`mcp-tool-adapter.ts`** — Syncs MCP-discovered tools into the local `ToolRegistry`
- **`mcp-observability.ts`** — Metrics, logging, status events
- **`health-service.ts`** — Periodic health checks for all connected MCP servers
- **`mcp-dashboard.ts`** — VS Code webview showing MCP server status
- **`mcp-status-bar.ts`** — VS Code status bar indicator for MCP health

## Dependencies
- `@types/vscode` — VS Code API types
- `typescript` — TypeScript compiler
- `@vscode/vsce` — Extension packager
- `@modelcontextprotocol/sdk` — MCP SDK
- `@modelcontextprotocol/server-filesystem` — Filesystem MCP server
- `@modelcontextprotocol/server-github` — GitHub MCP server
- `minimatch` — File pattern matching
- `vscode-as-mcp-server` — VS Code API as MCP server
- DeepSeek API (external) — LLM provider
