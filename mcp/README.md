# Spire MCP Servers

These MCP (Model Context Protocol) servers are produced as part of the [Spire](../) project — an AI coding assistant for DeepSeek v4 & VS Code. Each server provides core functionality that an AI assistant needs to operate effectively within a development environment.

## Available Servers

| Server | Description |
|--------|-------------|
| [**vsc-bridge**](./vsc-bridge/) | Bridges VS Code's internal APIs to MCP via an IPC socket, enabling AI assistants to read editor context, open files, show notifications, run commands, and search symbols. |
| [**graph-memory**](./graph-memory/) | Persistent graph-based memory using SparrowDB. Stores concepts, facts, and relationships so the assistant retains knowledge across sessions. |
| [**mcp-git**](./mcp-git/) | Full git operation support — status, diff, log, add, commit, branch, checkout, pull, push — through a single unified tool. |
| [**mcp-process**](./mcp-process/) | Process lifecycle management — start, monitor, send stdin, and kill long-running processes. Essential for running builds, tests, and dev servers. |
| [**mcp-search**](./mcp-search/) | Grep-like content search across the codebase with regex support, context lines, and glob filtering. Fast and stream-safe for large projects. |

Each server communicates via **JSON-RPC over stdio** and is independently runnable. Configure them in any MCP-compatible client (Cline, Claude Desktop, etc.).

## Quick Start

```bash
# Example: start the git operations server
cd mcp-git
npm install && npm run build && npm start
```

See each server's README for detailed configuration and usage.
