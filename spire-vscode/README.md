# Spire VS Code Extension

The VS Code extension for [Spire](../) — an AI coding assistant powered by DeepSeek v4 with local graph memory and MCP-native tool orchestration.

## Features

- **💬 Chat Panel** — Conversational interface with DeepSeek v4, including reasoning/thinking display
- **🗺️ Knowledge Graph** — Every session and exchange is stored as typed nodes in a local graph database (SQLite-backed)
- **📊 Graph Visualization** — Interactive force-directed graph in the sidebar with zoom, pan, search/filter, and node detail inspection
- **🔌 MCP Integration** — Built-in MCP client that connects to any MCP-compatible server (vsc-bridge, git, search, process)
- **🧠 Memory Bank** — Cross-session context files for long-running project awareness
- **🛠️ Multiple Workflows** — Agentic (autonomous), Direct (single-turn), and ReAct (reasoning + acting) modes

## Architecture

```
spire-vscode/
├── src/
│   ├── augmenter/
│   │   └── GraphPromptAugmenter.ts   # Stores exchanges as graph nodes/edges
│   ├── memory/
│   │   ├── MemoryGraph.ts            # In-memory graph with CRUD operations
│   │   ├── GraphDatabase.ts          # SQLite-backed graph persistence
│   │   ├── VectorIndex.ts            # Embedding-based similarity search
│   │   └── Embedder.ts               # Text embedding generation
│   ├── orchestration/
│   │   ├── orchestrator.ts           # Main orchestration engine
│   │   └── workflows/
│   │       ├── agentic-workflow.ts   # Autonomous multi-step agent
│   │       ├── react.ts              # ReAct (reason + act) loop
│   │       └── direct.ts             # Single-turn completion
│   ├── providers/
│   │   ├── SessionProvider.ts        # Session lifecycle management
│   │   ├── CompositeProvider.ts      # Multi-model routing
│   │   ├── GraphQueryProvider.ts     # Graph-aware query augmentation
│   │   └── GraphMemoryProvider.ts    # Graph memory tool provider
│   ├── ui/
│   │   ├── sidebar-html.ts           # Unified sidebar webview HTML
│   │   ├── sidebar-provider.ts       # Webview provider for sidebar
│   │   ├── chat-panel.ts             # Chat panel management
│   │   └── mcp-html.ts               # MCP dashboard HTML
│   ├── persistence/
│   │   └── SqlitePersistence.ts      # SQLite storage layer
│   ├── mcp/
│   │   ├── mcp-client.ts             # MCP JSON-RPC client
│   │   ├── mcp-manager.ts            # MCP server lifecycle
│   │   └── mcp-tool-adapter.ts       # MCP tool → VS Code tool adapter
│   └── extension.ts                  # Extension entry point
├── memory-bank/                      # Cross-session context files
├── resources/                        # Icons and assets
└── package.json                      # Extension manifest
```

## Graph Data Model

The local graph stores nodes of these types:

| Type | Description |
|------|-------------|
| `session` | A user session (created when the sidebar opens) |
| `conversation` | A single exchange (user message + assistant response) |
| `entity` | A named entity extracted from conversation context |
| `project` | A project or workspace reference |
| `decision` | A design or architectural decision |
| `blocker` | A problem or blocking issue |
| `milestone` | A project milestone or goal |
| `standard` | A coding standard or convention |
| `activeContext` | Current active context information |

Edges represent relationships: `related_to`, `part_of`, `follows`, `references`, `blocks`, `resolves`, etc.

## Build & Install

```bash
npm install
npm run compile          # TypeScript compilation
npm run package          # Create .vsix package
code --install-extension spire-vscode-*.vsix
```

## Development

```bash
npm run watch            # Watch mode for development
npm run test             # Run tests
```

## Configuration

- **DeepSeek API Key** — Set via VS Code settings (`spire.apiKey`) or the "Set API Key" command
- **MCP Servers** — Configured in VS Code settings under `spire.mcpServers`
- **Workflow Mode** — Selectable via the toolbar (Agentic / Direct / ReAct)
