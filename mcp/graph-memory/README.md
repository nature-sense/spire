# Graph Memory MCP

An MCP (Model Context Protocol) server that uses **SparrowDB** as an embedded graph database to store and retrieve semantic knowledge. Think of it as a simple, persistent, graph-based memory for AI assistants.

## Features

### Core Tools (CRUD)
- **`remember`** — Store concepts, facts, and their relationships in a graph
- **`recall`** — Retrieve stored concepts with optional related entities
- **`forget`** — Remove concepts (and their relationships) from the graph
- **`list`** — Browse all stored concepts, optionally filtered by category

### Semantic Tools (v0.2.0+)
- **`link`** — Create typed relationships between concepts (e.g., `DEPENDS_ON`, `LEADS`, `BLOCKS`)
- **`project_status`** — Get a structured status report for any project concept
- **`whats_blocking`** — Find all dependencies (up to 2 hops deep) of a concept
- **`summarize`** — Aggregate summary of the knowledge graph with category breakdowns and relationship counts

### Day 0 Graph Tools (v0.3.0+)
- **`query_knowledge_graph`** — Query the graph using natural language or Cypher
- **`find_shortest_path`** — BFS path finding between any two concepts
- **`get_node_neighbors`** — Traverse neighbors with depth and relationship filtering
- **`get_node_properties`** — Retrieve all or selected properties of a concept
- **`get_all_nodes`** — List all concepts with category filtering and offset pagination

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
| `DB_PATH` | `./data/graph.db` | Path to the SparrowDB database file |
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
      "env": {
        "DB_PATH": "/path/to/data/graph.db",
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

Valid relation types: `DEPENDS_ON`, `LEADS`, `INSPIRED_BY`, `BLOCKS`, `RELATED_TO`, `MENTIONS`, `CREATED_BY`

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
│   └── index.ts          # MCP server with all tool implementations
├── dist/                 # Compiled JavaScript (generated)
├── test-client.js        # End-to-end test script
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## API

This is an MCP server — it communicates via **JSON-RPC over stdio**. There is no HTTP server, no REST API, and no Docker required. It's designed to work as a plugin for any MCP-compatible client.

## How It Works

Each concept is stored as an `Entity` node in SparrowDB with properties like `id`, `name`, `details`, `category`, and timestamps. When a `related_to` relationship is specified, a `RELATED_TO` edge is created between the two entity nodes. The `id` property is a URL-safe slug derived from the concept name, used for efficient lookups and deduplication.

## Limitations

- **No DETACH DELETE support**: SparrowDB doesn't support Cypher's `DETACH DELETE`. The server works around this by deleting relationships before nodes.
- **No `SET` clause**: Updates are done via delete-then-create rather than `SET`.
- **Edge counter bug**: In rare cases, SparrowDB's internal edge counter may prevent node deletion even after all relationships are removed. The server handles this gracefully by leaving orphaned nodes that remain queryable but isolated.

## License

MIT
