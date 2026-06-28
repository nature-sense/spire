# Spire — AI Coding Assistant for DeepSeek v4 & VS Code

**Build upward with AI.** Spire is a powerful, MCP-native AI coding assistant that integrates [DeepSeek v4](https://deepseek.com) into VS Code with deep tool orchestration and persistent memory across sessions.

## Architecture

```
spire/
├── spire-vscode/            # VS Code extension (TypeScript)
│   ├── src/                 # Source code (compiled → out/)
│   ├── memory-bank/         # Cross-session context files
│   └── resources/           # Icons, assets
│
└── mcp/                     # Model Context Protocol servers
    ├── vsc-bridge/          # VS Code ↔ MCP bridge (IPC socket)
    ├── graph-memory/        # Persistent graph memory (SparrowDB)
    ├── mcp-search/          # Codebase search tools
    ├── mcp-process/         # Process management tools
    └── mcp-git/             # Git operations tools
```

## Key Features

- **🤖 DeepSeek v4 Integration** — Chat with DeepSeek v4's native thinking/reasoning capabilities
- **🔌 MCP-Native Design** — Extend functionality via any MCP-compatible server
- **🧠 Memory Bank** — Persistent cross-session context for long-running projects
- **🛠️ Multiple Workflow Modes** — Agentic, Direct, and ReAct strategies
- **📂 File Operations** — Read, write, edit files directly from chat
- **🔍 Codebase Search** — Search symbols, files, and content across your workspace

## Quick Start

### 1. Install the VS Code Extension

```bash
# From the spire-vscode directory
cd spire-vscode
npm install
npm run compile
npm run package
# Install the generated .vsix file
code --install-extension spire-vscode-*.vsix
```

### 2. Set Your API Key

Open VS Code → Settings → Extensions → Spire → enter your DeepSeek API key.

Or run the **Spire: Set API Key** command from the command palette.

### 3. Open the Chat

Click the Spire icon in the activity bar or run **Spire: Open Chat**.

## MCP Servers

Each MCP server under `mcp/` is independently runnable:

```bash
# Graph Memory
cd mcp/graph-memory && npm install && npm start

# VS Code Bridge
cd mcp/vsc-bridge && npm install && npm run build

# Search
cd mcp/mcp-search && npm install && npm start
```

Configure them via your MCP client settings (e.g., Cline, Claude Desktop).

## Development

```bash
# Build the extension
cd spire-vscode
npm run compile     # TypeScript compilation
npm run watch       # Watch mode

# Build MCP servers
cd mcp/vsc-bridge && npm run build
cd mcp/graph-memory && npm run build
```

## License

SPIRE
