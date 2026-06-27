# mcp-search — Content Search MCP Server

An MCP (Model Context Protocol) server that provides grep-like content search across files in a directory tree. Fast, flexible, and stream-safe — ideal for AI assistants needing to locate symbols, patterns, or text in large codebases.

## Features

- **Regex & plain-text** — Search with regular expressions or literal strings
- **Case sensitivity toggle** — Case-sensitive or case-insensitive matching
- **Context lines** — Surround matches with configurable before/after context
- **Glob filtering** — Include or exclude files by pattern (e.g., `**/*.ts`, `**/*.md`)
- **Stream-safe** — Line-by-line streaming for large files — no memory overhead
- **Smart defaults** — Automatically excludes `node_modules/`, `.git/`, `dist/`, `build/`, and other noise
- **Structured output** — Matches returned as JSON with file, line, content, and context

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
    "mcp-search": {
      "command": "node",
      "args": ["/path/to/spire/mcp/mcp-search/dist/index.js"]
    }
  }
}
```

## Usage — `search_content`

### Basic search (plain text)

```json
{
  "pattern": "useState",
  "path": "/path/to/project",
  "contextLines": 2,
  "include": ["**/*.tsx", "**/*.ts"]
}
```

### Regex search with case sensitivity

```json
{
  "pattern": "export\\s+(const|function)\\s+\\w+",
  "path": "/path/to/project",
  "regex": true,
  "caseSensitive": true,
  "include": ["**/*.ts"],
  "maxResults": 50
}
```

### Exclude specific directories

```json
{
  "pattern": "TODO",
  "path": "/path/to/project",
  "exclude": ["**/test/**", "**/vendor/**"],
  "contextLines": 1
}
```

### Search a single file

```json
{
  "pattern": "interface",
  "path": "/path/to/project/src/types.ts",
  "regex": false
}
```

## Parameters

| Parameter       | Type       | Default | Description                                                     |
|-----------------|------------|---------|-----------------------------------------------------------------|
| `pattern`       | `string`   | required| Search pattern (regex or plain text)                            |
| `path`          | `string`   | required| File or directory path to search                                |
| `regex`         | `boolean`  | `false` | Treat pattern as a regular expression                           |
| `caseSensitive` | `boolean`  | `false` | Enable case-sensitive matching                                  |
| `contextLines`  | `integer`  | `0`     | Number of context lines before and after each match             |
| `include`       | `string[]` | all     | Glob patterns to include (e.g. `["**/*.ts", "**/*.js"]`)       |
| `exclude`       | `string[]` | defaults| Glob patterns to exclude (adds to default excludes)             |
| `maxResults`    | `integer`  | `100`   | Maximum number of matches to return                             |

### Default Excludes

`mcp-search` automatically skips: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `coverage/`, `.cache/`, `*.log`, `*.min.js`, `*.min.css`, `vendor/`, `.DS_Store`

Custom `exclude` patterns are **added** to this list, not replaced.

## Response Format

```json
{
  "results": [
    {
      "file": "/path/to/project/src/index.ts",
      "line": 42,
      "content": "const [count, setCount] = useState(0);",
      "context": {
        "before": ["import React from 'react';", ""],
        "after": ["", "  return ("]
      }
    }
  ],
  "totalMatches": 15,
  "searchTime": 0.034
}
```

## How It Works

`mcp-search` uses [fast-glob](https://github.com/mrmlnc/fast-glob) to discover files matching the include/exclude patterns. Each file is read line-by-line using Node.js `readline` for memory safety on large files. The server communicates via **JSON-RPC over stdio**, making it compatible with any MCP-compatible client.

## Project Structure

```
mcp-search/
├── src/
│   └── index.ts      # MCP server with file discovery and line-by-line search
├── dist/             # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
