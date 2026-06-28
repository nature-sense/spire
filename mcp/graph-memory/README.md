# Graph Memory MCP

An MCP (Model Context Protocol) server that uses **SparrowDB** as an embedded graph database to store and retrieve semantic knowledge. Think of it as a simple, persistent, graph-based memory for AI assistants.

## Features

### Core Tools (CRUD)
- **`remember`** — Store concepts, facts, and their relationships in a graph
- **`recall`** — Retrieve stored concepts with optional related entities; falls back to semantic search on miss
- **`forget`** — Remove concepts (and their relationships) from the graph
- **`list`** — Browse all stored concepts, optionally filtered by category

### Semantic Tools
- **`link`** — Create typed relationships between concepts (e.g., `DEPENDS_ON`, `LEADS`, `BLOCKS`)
- **`project_status`** — Get a structured status report for any project concept
- **`whats_blocking`** — Find all dependencies (up to 2 hops deep) of a concept
- **`summarize`** — Aggregate summary of the knowledge graph with category breakdowns and relationship counts

### Graph Query Tools
- **`query_knowledge_graph`** — Query the graph using natural language or Cypher
- **`find_shortest_path`** — BFS path finding between any two concepts
- **`get_node_neighbors`** — Traverse neighbors with depth and relationship filtering
- **`get_node_properties`** — Retrieve all or selected properties of a concept
- **`get_all_nodes`** — List all concepts with category filtering and offset pagination

### Schema & Introspection
- **`get_schema`** — Introspect the graph schema: node properties, relationship types, and constraints with optional type-level filtering

### Semantic Search
- **`semantic_search`** — Search the knowledge graph by semantic meaning using embedding similarity (powered by Orama + Xenova Transformers.js)

### Code Import
- **`import_file`** — Import Python, C/C++, Dart, TypeScript, or Markdown source files into the graph, extracting functions, classes, structs, enums, namespaces, imports, and markdown sections as typed nodes with relationships

### Graph Viewer
- **Embedded HTTP viewer** — Visualize the knowledge graph at `http://localhost:{VIEWER_PORT}/graph` (default port 3000)

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run the server
npm start
```

## Configuration

The server is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `<cwd>/.spire/graph-memory` | Path to the SparrowDB database file (resolved relative to the process's current working directory) |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `VIEWER_PORT` | `3000` | Port for the graph viewer HTTP server |

## MCP Client Configuration

Add this to your MCP client settings (e.g., Cline's `cline_mcp_settings.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "graph-memory": {
      "command": "node",
      "args": ["/path/to/graph-memory-mcp/dist/index.js"],
      "cwd": "${workspaceRoot}",
      "env": {
        "VIEWER_PORT": "4000"
      }
    }
  }
}
```

## Available Tools

### `remember`

Store a concept in the graph.

```json
{
  "concept": "Quantum Computing",
  "details": "Computing using quantum-mechanical phenomena like superposition.",
  "category": "technology",
  "related_to": "Qubit"
}
```

### `recall`

Retrieve a stored concept.

```json
{
  "concept": "Quantum Computing",
  "include_related": true
}
```

### `forget`

Remove a concept and its relationships.

```json
{
  "concept": "Qubit"
}
```

### `list`

List all stored concepts, with optional category filter.

```json
{
  "category": "technology",
  "limit": 20
}
```

### `link`

Create a typed relationship between two existing concepts.

```json
{
  "from": "vsc-bridge",
  "to": "typescript",
  "relation": "DEPENDS_ON"
}
```

Valid relation types: `DEPENDS_ON`, `LEADS`, `INSPIRED_BY`, `BLOCKS`, `RELATED_TO`, `MENTIONS`, `CREATED_BY`, `SUPERSEDED_BY`

An optional `evidence` field can be supplied to reference a citation or file path justifying the relationship.

### `project_status`

Get a structured status report for a project concept, including its dependencies, blockers, and leads.

```json
{
  "name": "vsc-bridge"
}
```

### `whats_blocking`

Find all dependencies (up to 2 hops) of a concept via `DEPENDS_ON` relationships.

```json
{
  "concept": "vsc-bridge"
}
```

### `summarize`

Get an aggregate summary of the knowledge graph, optionally filtered by category and including relationship counts.

```json
{
  "category": "project",
  "include_relationships": true
}
```

### `query_knowledge_graph`

Query the graph using natural language or raw Cypher syntax. Detects Cypher keywords automatically.

```json
{
  "query": "What is the capital of France?",
  "limit": 10
}
```

### `find_shortest_path`

Find the shortest connection path between two concepts using BFS traversal.

```json
{
  "source": "Paris",
  "target": "London",
  "max_depth": 5
}
```

### `get_node_neighbors`

Get all neighboring concepts connected to a node, with optional relationship type and depth. Supports up to 3 hops.

```json
{
  "node_id": "Paris",
  "relationship_type": "DEPENDS_ON",
  "depth": 2
}
```

### `get_node_properties`

Retrieve all attributes of a specific concept, or select specific properties.

```json
{
  "node_id": "Paris",
  "properties": ["name", "details", "category"]
}
```

### `get_all_nodes`

List all concepts with optional category filtering and offset pagination.

```json
{
  "node_type": "city",
  "limit": 50,
  "offset": 0
}
```

### `get_schema`

Inspect the graph schema — returns node properties with types, valid relationship types, and constraints. Optionally filter by entity type for property recommendations.

```json
{
  "entity_type": "project"
}
```

### `semantic_search`

Search the graph by semantic meaning using embedding similarity. Ideal for natural-language queries or when you're unsure of the exact concept name.

```json
{
  "query": "quantum computing advances",
  "limit": 10
}
```

### `import_file`

Import a source file into the graph, extracting code structure as typed nodes and relationships. Supports **Python** (`.py`), **C/C++** (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.h`), **Dart** (`.dart`), **TypeScript/TSX** (`.ts`, `.tsx`), and **Markdown** (`.md`).

```json
{
  "file_path": "/path/to/project/src/main.py"
}
```

The importer extracts:
- Functions and methods with signatures, line ranges, and body previews
- Classes with inheritance relationships
- Structs, enums, and namespaces (C/C++/Dart)
- Imports between files (tracked as `IMPORTS` relationships)
- Markdown sections with heading hierarchies

## Testing

Two test clients are included to verify the server works end-to-end:

```bash
# Basic test (original 4 tools)
node test-client.js

# Full test (all 8 tools)
npx tsx test/test-tools.ts
```

### Basic test (`test-client.js`) tests:
1. Listing available tools
2. Storing two related concepts
3. Recalling a concept with relationships
4. Listing all concepts
5. Filtering by category
6. Removing a concept
7. Looking up a non-existent concept

### Full test (`test/test-tools.ts`) tests all 8 tools:
1. `remember` — Stores 4 concepts across categories
2. `link` — Creates typed relationships (DEPENDS_ON, LEADS) and handles duplicates/missing
3. `recall` — Retrieves a concept with related entities
4. `project_status` — Gets a structured report and handles missing projects
5. `whats_blocking` — Finds direct and indirect dependencies
6. `summarize` — Aggregates the graph with category breakdowns and relationship counts
7. `list` — Lists all concepts and filters by category
8. `forget` — Removes a concept and verifies removal

## Project Structure

```
graph-memory-mcp/
├── src/
│   ├── index.ts                  # MCP server with all 16 tool implementations
│   ├── importers/                # Language-specific code importers
│   │   ├── pythonImporter.ts     # Python AST importer (via tree-sitter-python)
│   │   ├── typescriptImporter.ts # TypeScript/TSX importer (via tree-sitter-typescript)
│   │   ├── cppImporter.ts        # C/C++ importer (via tree-sitter-cpp)
│   │   ├── dartImporter.ts       # Dart importer (via @plurnk/plurnk-mimetypes-grammar-dart)
│   │   └── markdownImporter.ts   # Markdown section importer
│   ├── tools/
│   │   └── importFileHelper.ts   # File routing logic for import_file tool
│   ├── services/
│   │   ├── orama-service.ts      # Semantic search index (Orama)
│   │   └── embedding-service.ts  # Text embeddings (Xenova Transformers.js)
│   ├── viewer/
│   │   ├── index.ts              # HTTP server for graph visualization
│   │   ├── routes.ts             # Graph data API endpoints
│   │   └── static/               # Frontend assets (HTML, JS, CSS)
│   └── types/
│       └── import.ts             # Shared type definitions for importers
├── dist/                         # Compiled JavaScript (generated)
├── test-client.js                # End-to-end test script
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## API

This is an MCP server — it communicates via **JSON-RPC over stdio**. There is no REST API and no Docker required. It's designed to work as a plugin for any MCP-compatible client.

In addition to the stdio MCP transport, the server starts an **embedded HTTP server** for the [Graph Viewer](#graph-viewer), available at `http://localhost:{VIEWER_PORT}/graph`.

## How It Works

Each concept is stored as an `Entity` node in SparrowDB with properties like `id`, `name`, `details`, `category`, and timestamps. When a `related_to` relationship is specified, a `RELATED_TO` edge is created between the two entity nodes. The `id` property is a URL-safe slug derived from the concept name, used for efficient lookups and deduplication.

### Semantic Search

On startup, the server initialises an **Orama** full-text + vector index. When concepts are stored via `remember`, they are automatically indexed. The `semantic_search` tool uses **Xenova Transformers.js** to compute embeddings and find the most relevant concepts by cosine similarity. If initialization fails (e.g., no model available), semantic search gracefully degrades and logs a warning.

### Code Import

The `import_file` tool uses **tree-sitter** parsers to parse source files, extract syntactic constructs (functions, classes, structs, enums, namespaces, imports, markdown sections), and creates typed Entity nodes with `source: 'python_ast'`, `'cpp_clang'`, `'dart_analyzer'`, `'typescript_ast'`, or `'markdown'`. Relationships such as `DEFINES`, `INHERITS_FROM`, `CONTAINS`, and `IMPORTS` are created between nodes to preserve the code structure in the graph.

### Graph Viewer

The embedded viewer serves an interactive D3.js-based graph visualization. Access it at `http://localhost:{VIEWER_PORT}/graph` to browse nodes and relationships visually.

## Limitations

- **No DETACH DELETE support**: SparrowDB doesn't support Cypher's `DETACH DELETE`. The server works around this by deleting relationships before nodes.
- **No `SET` clause**: Updates are done via delete-then-create rather than `SET`.
- **Edge counter bug**: In rare cases, SparrowDB's internal edge counter may prevent node deletion even after all relationships are removed. The server handles this gracefully by leaving orphaned nodes that remain queryable but isolated.

## License

MIT
