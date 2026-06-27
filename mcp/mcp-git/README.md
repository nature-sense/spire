# mcp-git — Git Operations MCP Server

An MCP (Model Context Protocol) server that exposes full git functionality to AI assistants — read repository state, stage changes, commit, branch, pull, and push — all through a single tool.

## Features

- **Single unified tool** — `git_operation` wraps every git command behind one clean interface
- **Non-destructive reads** — `status`, `diff`, and `log` are safe inspection commands
- **Full write support** — `add`, `commit`, `branch create/delete`, `checkout`, `pull`, `push`
- **Configurable repo path** — Operate on any repository, defaulting to the current working directory
- **Structured JSON output** — Every operation returns `{ success, data, message }`

### Supported Operations

| Operation   | Description                                                | Parameters                                          |
|-------------|------------------------------------------------------------|-----------------------------------------------------|
| `status`    | Show working tree status                                   | `repoPath?`                                         |
| `diff`      | Show unstaged/staged changes                               | `repoPath?`, `files?`                               |
| `log`       | Show commit history                                        | `repoPath?`, `limit?`, `file?`                      |
| `add`       | Stage files                                                | `repoPath?`, `files`                                |
| `commit`    | Create a commit                                            | `repoPath?`, `message` (required), `files?`         |
| `branch`    | List / create / delete branches                            | `repoPath?`, `branch?`                              |
| `checkout`  | Switch branches or restore files                           | `repoPath?`, `branch`, `files?`                     |
| `pull`      | Fetch and merge from remote                                | `repoPath?`, `remote?`, `branch?`                   |
| `push`      | Push to remote                                             | `repoPath?`, `remote?`, `branch?`                   |

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
    "mcp-git": {
      "command": "node",
      "args": ["/path/to/spire/mcp/mcp-git/dist/index.js"]
    }
  }
}
```

## Usage Examples

### Check repository status

```json
{
  "operation": "status"
}
```

### Stage and commit changes

```json
{
  "operation": "add",
  "args": {
    "files": ["README.md", "src/index.ts"]
  }
}
```

```json
{
  "operation": "commit",
  "args": {
    "message": "Add new feature"
  }
}
```

### View recent commits

```json
{
  "operation": "log",
  "args": {
    "limit": 5,
    "file": "src/index.ts"
  }
}
```

### Branch management

```json
{
  "operation": "branch",
  "args": {
    "branch": "feature/awesome"
  }
}
```

### Push to a remote

```json
{
  "operation": "push",
  "args": {
    "remote": "origin",
    "branch": "main"
  }
}
```

## How It Works

`mcp-git` uses [simple-git](https://github.com/steveukx/git-js) to execute git commands in the target repository. It communicates via **JSON-RPC over stdio**, making it compatible with any MCP-compatible client. All operations return structured results with `success`, `data`, and a human-readable `message`.

## Project Structure

```
mcp-git/
├── src/
│   └── index.ts      # MCP server with all git operations
├── dist/             # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
