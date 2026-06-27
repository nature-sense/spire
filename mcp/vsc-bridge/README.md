# VS Code MCP Bridge

Bridges VS Code's internal APIs to an MCP (Model Context Protocol) server over a Unix domain socket, enabling AI assistants to interact with VS Code programmatically.

## Architecture

```
┌──────────────────────┐         IPC Socket          ┌──────────────────────┐
│   VS Code Extension  │  ←── ~/.spire/vscode-ipc.sock ──→  │     MCP Server       │
│   (spire-vsc-bridge) │     JSON-RPC over socket      │  (@spire/vsc-bridge- │
│                      │                              │      mcp)            │
│                      │                              │                      │
│   - Exposes VS Code  │                              │   - stdio transport   │
│     APIs via IPC     │                              │   - Connects to exten │
│   - Status bar item   │                              │   - Exposes MCP tools │
└──────────────────────┘                              └──────────┬───────────┘
                                                               │
                                                    ┌──────────▼───────────┐
                                                    │    MCP Client        │
                                                    │  (Claude Desktop,    │
                                                    │   Cline, etc.)       │
                                                    └──────────────────────┘
```

## Prerequisites

- Node.js 18+
- VS Code 1.85+
- TypeScript 5.3+

## Quick Start

### 1. Build everything

```bash
./scripts/build.sh
```

### 2. Install the VS Code extension

```bash
./scripts/install-extension.sh
```

Then reload VS Code (`Developer: Reload Window`).

### 3. Verify the extension is running

Look for the **"VSC Bridge"** status bar item in the bottom-right of VS Code.

- Click it to see status
- Run `VSC Bridge: Start` / `VSC Bridge: Stop` / `VSC Bridge: Status` from the command palette

### 4. Use the MCP server

The MCP server uses **stdio transport**, so you can connect it to any MCP client.

For example, with Cline, add this to your MCP configuration:

```json
{
  "mcpServers": {
    "vsc-bridge": {
      "command": "node",
      "args": ["/path/to/vsc-bridge/packages/mcp-server/dist/index.js"],
      "env": {
        "VSCODE_IPC_PATH": "$HOME/.spire/vscode-ipc.sock"
      }
    }
  }
}
```

## Available MCP Tools

| Tool                 | Description                                   |
|----------------------|-----------------------------------------------|
| `get_editor_context` | Returns active file, cursor, selection, open files |
| `open_file`          | Opens a file at a specific line/column        |
| `get_diagnostics`    | Returns diagnostics for a file or all files   |
| `show_notification`  | Shows info/warning/error toast in VS Code     |
| `show_input_box`     | Shows an input box and returns user input      |
| `run_command`        | Executes any VS Code command                   |
| `search_symbols`     | Searches for symbols in the workspace         |

## JSON-RPC Protocol

The extension exposes these methods via IPC socket:

| Method              | Params                                               | Returns                             |
|---------------------|------------------------------------------------------|-------------------------------------|
| `getContext`        | `{}`                                                 | `EditorContext`                     |
| `openFile`          | `{ path: string, line?: number, column?: number }`   | `{ success: true }`                |
| `getDiagnostics`    | `{ path?: string }`                                  | `DiagnosticsResult`                 |
| `showNotification`  | `{ message: string, type: "info"|"warning"|"error" }`| `{ success: true }`                |
| `showInputBox`      | `{ prompt: string, value?: string }`                 | `{ value: string \| undefined }`   |
| `runCommand`        | `{ command: string, args?: any[] }`                  | `{ result: any }`                  |
| `searchSymbols`     | `{ query: string }`                                  | `SymbolResult[]`                   |
| `findReferences`    | `{ path: string, line: number, column: number }`     | `ReferenceLocation[]`              |
| `getCompletions`    | `{ path: string, line: number, column: number }`     | `CompletionItem[]`                 |
| `applyCodeAction`   | `{ path: string, diagnostic: object }`              | `{ success: true }`                |

## Manual Build Steps

```bash
# Install all dependencies
npm install

# Build both packages
npm run build

# Build individually
npm run build -w packages/mcp-server
npm run build -w packages/vscode-extension

# Package the extension
npm run package:extension
```

## Cleanup

The extension creates a socket file at `~/.spire/vscode-ipc.sock`. This is automatically cleaned up when the extension is deactivated or VS Code exits.

## License

SPIRE
