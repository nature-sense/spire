# mcp-process — Process Management MCP Server

An MCP (Model Context Protocol) server for starting, managing, and interacting with long-running processes. AI assistants can spawn processes, stream output, send stdin input, and kill them when done.

## Features

- **Start processes** — Spawn any command with configurable working directory, environment variables, and timeout
- **Stream stdout/stderr** — Capture and retrieve real-time output from running processes
- **Interactive stdin** — Send input to running processes (e.g., respond to prompts)
- **Signal control** — Kill processes with `SIGTERM`, `SIGINT`, or `SIGKILL`
- **Timeout support** — Automatically terminate processes that exceed a time limit
- **Output ring buffer** — Preserves the last 1000 lines of output per process

### Tools

| Tool                   | Description                                              |
|------------------------|----------------------------------------------------------|
| `start_process`        | Start a new process, returns a process ID                |
| `process_send_stdin`   | Send text input to a running process's stdin             |
| `process_kill`         | Stop a running process by sending a signal               |
| `process_get_output`   | Get captured stdout/stderr from a running/completed process |

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
npm start
```

## MCP Client Configuration

Add this to your MCP client settings (Cline, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "mcp-process": {
      "command": "node",
      "args": ["/path/to/spire/mcp/mcp-process/dist/index.js"]
    }
  }
}
```

## Usage Examples

### Start a process

```json
{
  "command": "npm run build",
  "cwd": "/path/to/project",
  "timeout": 60000
}
```

*Returns:* `{ processId, pid, status, startTime }`

### Send input to a running process

```json
{
  "processId": "abc123",
  "input": "yes",
  "newline": true
}
```

### Check output

```json
{
  "processId": "abc123",
  "tail": 20,
  "since": 1700000000000
}
```

*Returns the last 20 lines from stdout and stderr. The `since` parameter (Unix ms timestamp) returns all output captured after that time (note: per-line timestamps are not tracked; if `since` is before process start, all output is returned).*

### Kill a process

```json
{
  "processId": "abc123",
  "signal": "SIGTERM"
}
```

*Valid signals:* `SIGTERM` (default), `SIGINT`, `SIGKILL`

## Advanced: Start Process Parameters

| Parameter  | Type      | Default  | Description                                   |
|------------|-----------|----------|-----------------------------------------------|
| `command`  | `string`  | required | Full command to execute (e.g. `"npm run build"`) |
| `cwd`      | `string`  | CWD      | Working directory for the process              |
| `env`      | `object`  | `{}`     | Environment variables to set (merged with parent) |
| `timeout`  | `integer` | none     | Timeout in ms; process is killed with SIGTERM if exceeded |
| `shell`    | `boolean` | `true`   | Use shell to execute the command               |

## How It Works

`mcp-process` uses Node.js `child_process.spawn()` to launch processes with full control. Each process gets a unique ID and its stdout/stderr are captured in circular buffers. The server communicates via **JSON-RPC over stdio**, making it compatible with any MCP-compatible client. On shutdown (`SIGINT`/`SIGTERM`), all managed processes are cleaned up automatically.

## Project Structure

```
mcp-process/
├── src/
│   └── index.ts      # MCP server with ProcessManager
├── dist/             # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
