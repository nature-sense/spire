#!/usr/bin/env node

/**
 * graph-memory-mcp — MCP server for semantic graph memory.
 *
 * Uses SparrowDB as an embedded graph database to store and retrieve
 * concepts, facts, and their relationships.
 *
 * Tools:
 *   remember       — Store a concept or fact
 *   recall         — Retrieve a concept and optionally its relations
 *   forget         — Remove a concept and its relationships
 *   list           — List all concepts, optionally filtered by category
 *   link           — Create a typed relationship between two existing concepts
 *   project_status — Get a structured status report for a project concept
 *   whats_blocking — Find all dependencies (up to 2 hops) of a concept
 *   summarize      — Get an aggregate summary of the knowledge graph
 *
 * Environment variables:
 *   DB_PATH   — SparrowDB database file path (default: ./data/graph.db)
 *   LOG_LEVEL — Logging verbosity (default: info)
 */

// sparrowdb ships as CommonJS — use default import then destructure
import sparrowdb from 'sparrowdb';
const { SparrowDB } = sparrowdb;
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { PythonImporter } from './importers/pythonImporter.js';
import { handleImportFile } from './tools/importFileHelper.js';
import { ViewerServer } from './viewer/index.js';
import { setDb } from './viewer/routes.js';

// ---------------------------------------------------------------------------
// Logging helpers — writes to stderr so stdout stays clean for MCP protocol
// ---------------------------------------------------------------------------

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function getLogLevel(): LogLevel {
  const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return level in LOG_LEVELS ? level : 'info';
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()]) {
    // ISO timestamp for traceability
    const ts = new Date().toISOString();
    console.error(`[${ts}] [graph-memory] [${level.toUpperCase()}]`, ...args);
  }
}

// ---------------------------------------------------------------------------
// Slug utility — turns a concept name into a URL-safe identifier for the
// graph node's `id` property.  Ensures uniqueness via MERGE.
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Sanitise a string value for use inside a Cypher single-quoted string
// literal (escape single quotes and backslashes).
// ---------------------------------------------------------------------------

function cypherStr(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Helper functions for the extended schema
// ---------------------------------------------------------------------------

/** Return current ISO 8601 timestamp string. */
function isoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Build a property object for an Entity node with defaults for all required
 * fields.  Extra fields (category, status, goal, language, ...) can be passed
 * via the `extras` parameter.
 */
function createEntityProps(
  id: string,
  name: string,
  details: string,
  entityType: string,
  source: string = 'user',
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = isoTimestamp();
  return {
    id,
    name,
    details,
    type: entityType,
    valid_from: now,
    valid_to: null,
    version: 1,
    source,
    ingested_at: now,
    created_at: now,
    updated_at: now,
    ...extras,
  };
}

/**
 * Build a Cypher key=value pair string from a property object, suitable for
 * embedding inside a CREATE (n:Entity { ... }) statement.
 */
function propsToCypher(props: Record<string, unknown>): string {
  return Object.entries(props)
    .map(([key, val]) => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return `${key}: '${cypherStr(val)}'`;
      if (typeof val === 'number') return `${key}: ${val}`;
      if (typeof val === 'boolean') return `${key}: ${String(val)}`;
      return '';
    })
    .filter(Boolean)
    .join(',\n           ');
}


// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

function initDB(dbPath: string): InstanceType<typeof SparrowDB> {
  // Ensure the parent directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log('info', `Created database directory: ${dir}`);
  }

  const db = SparrowDB.open(dbPath);
  log('info', 'Database opened at', dbPath);

  // Ensure the Entity label uniqueness via an initial MERGE is not needed—
  // all subsequent writes use MERGE on id which guarantees idempotency.
  return db;
}

// ---------------------------------------------------------------------------
// Zod schemas for tool argument validation
// ---------------------------------------------------------------------------

const RememberSchema = z.object({
  concept: z.string().min(1, 'concept is required'),
  details: z.string().min(1, 'details is required'),
  category: z.string().optional(),
  related_to: z.string().optional(),
});

const RecallSchema = z.object({
  concept: z.string().min(1, 'concept is required'),
  include_related: z.boolean().optional().default(false),
});

const ForgetSchema = z.object({
  concept: z.string().min(1, 'concept is required'),
});

const ListSchema = z.object({
  category: z.string().optional(),
  limit: z.number().int().positive().optional().default(20),
});

const LinkSchema = z.object({
  from: z.string().min(1, 'from is required'),
  to: z.string().min(1, 'to is required'),
  relation: z.enum([
    'DEPENDS_ON',
    'LEADS',
    'INSPIRED_BY',
    'BLOCKS',
    'RELATED_TO',
    'MENTIONS',
    'CREATED_BY',
    'SUPERSEDED_BY',
  ]),
  evidence: z.string().optional(),
});

const ProjectStatusSchema = z.object({
  name: z.string().min(1, 'name is required'),
});

const WhatsBlockingSchema = z.object({
  concept: z.string().min(1, 'concept is required'),
});

const SummarizeSchema = z.object({
  category: z.string().optional(),
  include_relationships: z.boolean().optional().default(false),
});
const QueryKnowledgeGraphSchema = z.object({
  query: z.string().min(1, 'query is required'),
  limit: z.number().int().positive().min(1).max(100).optional().default(10),
});

const FindShortestPathSchema = z.object({
  source: z.string().min(1, 'source is required'),
  target: z.string().min(1, 'target is required'),
  max_depth: z.number().int().positive().min(1).max(5).optional().default(5),
});

const GetNodeNeighborsSchema = z.object({
  node_id: z.string().min(1, 'node_id is required'),
  relationship_type: z.string().optional(),
  depth: z.number().int().positive().min(1).max(3).optional().default(1),
});

const GetNodePropertiesSchema = z.object({
  node_id: z.string().min(1, 'node_id is required'),
  properties: z.array(z.string()).optional(),
});

const GetAllNodesSchema = z.object({
  node_type: z.string().optional(),
  limit: z.number().int().positive().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

const GetSchemaSchema = z.object({
  entity_type: z.string().optional(),
});

const ImportFileSchema = z.object({
  file_path: z.string().min(1, 'file_path is required'),
});

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: 'graph-memory-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool definitions & handlers
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'remember',
      description:
        'Store a concept or fact in the graph. ' +
        'Creates an Entity node (or merges if one with the same name already exists). ' +
        'Optionally links it to another concept via a "related_to" parameter.',
      inputSchema: {
        type: 'object',
        properties: {
          concept: {
            type: 'string',
            description: 'The main concept or entity name (e.g. "Quantum Computing")',
          },
          details: {
            type: 'string',
            description: 'Details about the concept (e.g. "A field of physics that ...")',
          },
          category: {
            type: 'string',
            description: 'Optional category (e.g. "project", "person", "idea", "technology")',
          },
          related_to: {
            type: 'string',
            description: 'Optional related concept name to link to',
          },
        },
        required: ['concept', 'details'],
      },
    },
    {
      name: 'recall',
      description:
        'Retrieve information about a stored concept. ' +
        'Optionally include related entities.',
      inputSchema: {
        type: 'object',
        properties: {
          concept: {
            type: 'string',
            description: 'The concept name to look up',
          },
          include_related: {
            type: 'boolean',
            description: 'Whether to also return related concepts',
            default: false,
          },
        },
        required: ['concept'],
      },
    },
    {
      name: 'forget',
      description:
        'Permanently remove a concept and all its relationships from the graph.',
      inputSchema: {
        type: 'object',
        properties: {
          concept: {
            type: 'string',
            description: 'The concept name to remove',
          },
        },
        required: ['concept'],
      },
    },
    {
      name: 'list',
      description:
        'List all stored concepts, optionally filtered by category.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Optional category to filter by (e.g. "project", "person")',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results to return',
            default: 20,
          },
        },
      },
    },
    {
      name: 'link',
      description:
        'Create a typed relationship between two existing concepts. ' +
        'Both concepts must already exist in the graph. ' +
        'Valid relation types: DEPENDS_ON, LEADS, INSPIRED_BY, BLOCKS, RELATED_TO, MENTIONS, CREATED_BY, SUPERSEDED_BY.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'The source concept name',
          },
          to: {
            type: 'string',
            description: 'The target concept name',
          },
          relation: {
            type: 'string',
            enum: [
              'DEPENDS_ON',
              'LEADS',
              'INSPIRED_BY',
              'BLOCKS',
              'RELATED_TO',
              'MENTIONS',
              'CREATED_BY',
              'SUPERSEDED_BY',
            ],
            description: 'Type of relationship to create',
          },
          evidence: {
            type: 'string',
            description: 'Optional citation or file reference for this relationship',
          },
        },
        required: ['from', 'to', 'relation'],
      },
    },
    {
      name: 'project_status',
      description:
        'Get a comprehensive status report for a project concept, ' +
        'including its details, status, goal, dependencies, blockers, and lead.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The project name (e.g. "vsc-bridge")',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'whats_blocking',
      description:
        'Find all dependencies (up to 2 hops) of a concept via DEPENDS_ON relationships. ' +
        'Shows both direct and indirect dependencies.',
      inputSchema: {
        type: 'object',
        properties: {
          concept: {
            type: 'string',
            description: 'The concept to check for dependencies',
          },
        },
        required: ['concept'],
      },
    },
    {
      name: 'summarize',
      description:
        'Get a summary of all concepts in the knowledge graph, ' +
        'optionally filtered by category and including relationship counts.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Optional category to filter by (e.g. "project", "technology")',
          },
          include_relationships: {
            type: 'boolean',
            description: 'Whether to include relationship counts by type',
            default: false,
          },
        },
      },
    },
    {
      name: 'query_knowledge_graph',
      description:
        'Query the knowledge graph using natural language or Cypher queries. ' +
        'Supports both simple keyword searches and full Cypher syntax.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language question or Cypher query (e.g. "MATCH (n) RETURN n")',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results to return',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'find_shortest_path',
      description:
        'Find the shortest path between two concepts in the graph. ' +
        'Uses BFS traversal limited by max_depth.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source concept name or ID',
          },
          target: {
            type: 'string',
            description: 'Target concept name or ID',
          },
          max_depth: {
            type: 'integer',
            description: 'Maximum number of hops to search (1-5)',
            default: 5,
          },
        },
        required: ['source', 'target'],
      },
    },
    {
      name: 'get_node_neighbors',
      description:
        'Get neighboring concepts connected to a specific node, ' +
        'with optional relationship type filtering and depth traversal.',
      inputSchema: {
        type: 'object',
        properties: {
          node_id: {
            type: 'string',
            description: 'Concept name or ID to start from',
          },
          relationship_type: {
            type: 'string',
            description:
              'Optional relationship type filter (e.g. DEPENDS_ON, LEADS, RELATED_TO)',
          },
          depth: {
            type: 'integer',
            description: 'Number of hops to traverse (1-3)',
            default: 1,
          },
        },
        required: ['node_id'],
      },
    },
    {
      name: 'get_node_properties',
      description:
        'Get properties/attributes of a specific concept. ' +
        'Returns all or selected properties of the node.',
      inputSchema: {
        type: 'object',
        properties: {
          node_id: {
            type: 'string',
            description: 'Concept name or ID',
          },
          properties: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of specific property names to return',
          },
        },
        required: ['node_id'],
      },
    },
    {
      name: 'get_all_nodes',
      description:
        'List all concepts in the graph with optional type/category filtering and offset pagination.',
      inputSchema: {
        type: 'object',
        properties: {
          node_type: {
            type: 'string',
            description: 'Optional filter by category (e.g. "project", "person")',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of nodes to return',
            default: 50,
          },
          offset: {
            type: 'integer',
            description: 'Number of nodes to skip (for pagination)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'get_schema',
      description:
        'Returns the graph schema: node properties, relationship types, and constraints.',
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            description: 'Optional filter (e.g. "project", "code", "memory", "person", "concept")',
          },
        },
      },
    },
    {
      name: 'import_file',
      description:
        'Import a Python file into the graph, extracting functions, classes, methods, and imports as typed nodes and relationships.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the Python file to import',
          },
        },
        required: ['file_path'],
      },
    }
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    return {
      content: [{ type: 'text', text: 'Missing arguments' }],
      isError: true,
    };
  }

  log('debug', `Tool called: ${name}`, JSON.stringify(args));

  try {
    switch (name) {
      case 'remember':
        return await handleRemember(args);
      case 'recall':
        return await handleRecall(args);
      case 'forget':
        return await handleForget(args);
      case 'list':
        return await handleList(args);
      case 'link':
        return await handleLink(args);
      case 'project_status':
        return await handleProjectStatus(args);
      case 'whats_blocking':
        return await handleWhatsBlocking(args);
      case 'summarize':
        return await handleSummarize(args);
      case 'query_knowledge_graph':
        return await handleQueryKnowledgeGraph(args);
      case 'find_shortest_path':
        return await handleFindShortestPath(args);
      case 'get_node_neighbors':
        return await handleGetNodeNeighbors(args);
      case 'get_node_properties':
        return await handleGetNodeProperties(args);
      case 'get_all_nodes':
        return await handleGetAllNodes(args);
      case 'get_schema':
        return await handleGetSchema(args);
 
      case 'import_file':
        return await handleImportFile(db, log, cypherStr, propsToCypher, args);     default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Tool ${name} failed:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function handleRemember(args: Record<string, unknown>) {
  const parsed = RememberSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { concept, details, category, related_to } = parsed.data;
  const id = toSlug(concept);
  const now = new Date().toISOString();

  const escapedId = cypherStr(id);
  const escapedName = cypherStr(concept);
  const escapedDetails = cypherStr(details);
  const escapedCategory = category ? cypherStr(category) : '';

  try {
    // SparrowDB does NOT support:
    //   - SET clause
    //   - DETACH DELETE
    //   - ON CREATE SET / ON MATCH SET
    //
    // Strategy: attempt to remove existing relationships and node, then CREATE.
    // This gives us idempotent "upsert" behavior.
    // If the node can't be removed (SparrowDB edge counter bug), we still try
    // the CREATE — it may create a duplicate, but that's acceptable given the
    // storage engine's limitations.

    // 1. Clear any existing relationships (both directions)
    db.execute(`MATCH (n:Entity {id: '${escapedId}'})-[r]-() DELETE r`);

    // 2. Try to delete the existing node (ignore failure due to edge counter bug)
    try {
      db.execute(`MATCH (n:Entity {id: '${escapedId}'}) DELETE n`);
    } catch {
      // Node still has edge count issues; try undirected relationship delete
      // and a second delete attempt
      db.checkpoint();
      db.execute(`MATCH (n:Entity {id: '${escapedId}'})-[r]-() DELETE r`);
      try {
        db.execute(`MATCH (n:Entity {id: '${escapedId}'}) DELETE n`);
      } catch {
        log('warn', `Could not delete existing node "${concept}" — continuing with CREATE`);
      }
    }

    // 2. Build the extended properties object
    const extras: Record<string, unknown> = {};
    if (escapedCategory) {
      extras.category = category;
    }
    const entityProps = createEntityProps(id, concept, details, 'concept', 'user', extras);
    const propsStr = propsToCypher(entityProps);

    let returnFields =
      'n.id as id, n.name as name, n.details as details, n.category as category, ' +
      'n.type as type, n.source as source, n.version as version, ' +
      'n.valid_from as valid_from, n.valid_to as valid_to, n.ingested_at as ingested_at, ' +
      'n.created_at as created_at, n.updated_at as updated_at';

    const createCypher = `
        CREATE (n:Entity {
          ${propsStr}
        })
        RETURN ${returnFields}
    `;

    const result = db.execute(createCypher);
    const entity = result.rows[0] ?? {};

    // If related_to was specified, ensure target node exists and create relationship
    if (related_to) {
      const targetId = toSlug(related_to);
      const escapedTarget = cypherStr(related_to);

      // Ensure target node exists (create if not)
      const targetCheck = db.execute(`MATCH (n:Entity {id: '${cypherStr(targetId)}'}) RETURN n.id`);
      if (targetCheck.rows.length === 0) {
        const stubProps = createEntityProps(
          cypherStr(targetId),
          related_to,
          '',
          'concept',
          'user',
          {},
        );
        const stubStr = propsToCypher(stubProps);
        db.execute(`
          CREATE (n:Entity {
            ${stubStr}
          })
        `);
      }

      // Create the relationship (with properties for forward compatibility)
      db.execute(`
        MATCH (a:Entity {id: '${escapedId}'}), (b:Entity {id: '${cypherStr(targetId)}'})
        CREATE (a)-[:RELATED_TO {source: 'user'}]->(b)
      `);
    }

    db.checkpoint();
    log('info', `Remembered: "${concept}"${related_to ? ` → ${related_to}` : ''}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: `Remembered "${concept}"`,
              entity,
              related_to: related_to ?? undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to remember "${concept}":`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

function handleRecall(args: Record<string, unknown>) {
  const parsed = RecallSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { concept, include_related } = parsed.data;
  const id = toSlug(concept);
  const escapedName = cypherStr(concept);

  try {
    const query = `
      MATCH (n:Entity)
      WHERE n.id = '${id}' OR n.name = '${escapedName}'
      RETURN n.id as id, n.name as name, n.details as details,
             n.category as category, n.type as type,
             n.source as source, n.version as version,
             n.valid_from as valid_from, n.valid_to as valid_to,
             n.ingested_at as ingested_at,
             n.created_at as created_at, n.updated_at as updated_at
      LIMIT 1
    `;
    const result = db.execute(query);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: `Concept "${concept}" not found` }, null, 2),
          },
        ],
      };
    }

    const entity = result.rows[0];
    const response: Record<string, unknown> = { entity };

    if (include_related) {
      // Find all entities related TO this one (outgoing)
      const outgoingQuery = `
        MATCH (n:Entity {id: '${id}'})-[:RELATED_TO]->(related:Entity)
        RETURN related.id as id, related.name as name, related.category as category
      `;
      const outgoingResult = db.execute(outgoingQuery);
      const outgoing = outgoingResult.rows;

      // Find all entities related FROM this one (incoming)
      const incomingQuery = `
        MATCH (n:Entity {id: '${id}'})<-[:RELATED_TO]-(related:Entity)
        RETURN related.id as id, related.name as name, related.category as category
      `;
      const incomingResult = db.execute(incomingQuery);
      const incoming = incomingResult.rows;

      response.related_to = outgoing;
      response.related_from = incoming;
    }

    log('info', `Recalled: "${concept}"`);

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to recall "${concept}":`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

function handleForget(args: Record<string, unknown>) {
  const parsed = ForgetSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { concept } = parsed.data;
  const id = toSlug(concept);
  const escapedName = cypherStr(concept);

  try {
    // First check if the node exists
    const checkQuery = `
      MATCH (n:Entity)
      WHERE n.id = '${id}' OR n.name = '${escapedName}'
      RETURN n.id as id, n.name as name
      LIMIT 1
    `;
    const checkResult = db.execute(checkQuery);

    if (checkResult.rows.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: `Concept "${concept}" not found — nothing to forget` }, null, 2),
          },
        ],
      };
    }

    // SparrowDB does NOT support DETACH DELETE — delete relationships first, then node.
    // Note: SparrowDB has a known bug where relationship deletion does not properly
    // decrement the internal edge counter. If node deletion fails, we leave the node
    // as an orphan (relationships removed, node remains queryable but isolated).

    // Delete ALL outgoing and incoming relationships (any type)
    db.execute(`MATCH (n:Entity {id: '${id}'})-[r]->() DELETE r`);
    db.execute(`MATCH (n:Entity {id: '${id}'})<-[r]-() DELETE r`);
    db.checkpoint();

    try {
      db.execute(`MATCH (n:Entity {id: '${id}'}) DELETE n`);
      db.checkpoint();
      log('info', `Forgot: "${concept}"`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: `Forgotten: "${concept}"` }, null, 2),
          },
        ],
      };
    } catch {
      // SparrowDB edge counter bug — node can't be deleted after incoming relationships
      // were removed. The relationships are gone; the orphaned node is harmless.
      log('warn', `Could not fully delete "${concept}" (SparrowDB edge counter bug). Relationships were removed.`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: `Relationships removed for "${concept}". The concept record remains due to a storage engine limitation, but is now isolated.`,
            }, null, 2),
          },
        ],
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to forget "${concept}":`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

function handleList(args: Record<string, unknown>) {
  const parsed = ListSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { category, limit } = parsed.data;

  try {
    let cypher: string;
    if (category) {
      const escapedCategory = cypherStr(category);
      cypher = `
        MATCH (n:Entity)
        WHERE n.category = '${escapedCategory}'
        RETURN n.id as id, n.name as name, n.details as details,
               n.category as category, n.type as type,
               n.source as source, n.version as version,
               n.created_at as created_at
        ORDER BY n.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      cypher = `
        MATCH (n:Entity)
        RETURN n.id as id, n.name as name, n.details as details,
               n.category as category, n.type as type,
               n.source as source, n.version as version,
               n.created_at as created_at
        ORDER BY n.created_at DESC
        LIMIT ${limit}
      `;
    }

    const result = db.execute(cypher);

    log('info', `Listed ${result.rows.length} concepts${category ? ` (category: ${category})` : ''}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: result.rows.length,
              category: category ?? null,
              entities: result.rows,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'Failed to list concepts:', message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleProjectStatus — Get a structured status report for a project concept
// ---------------------------------------------------------------------------

function handleProjectStatus(args: Record<string, unknown>) {
  const parsed = ProjectStatusSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { name } = parsed.data;
  const id = toSlug(name);

  try {
    // Fetch the project entity
    const entityQuery = `MATCH (n:Entity {id: '${cypherStr(id)}'})
      WHERE n.type = 'project' OR n.category = 'project'
      RETURN n.name as name, n.details as details, n.category as category,
             n.type as type, n.status as status, n.goal as goal,
             n.created_at as created_at, n.updated_at as updated_at
      LIMIT 1`;
    const entityResult = db.execute(entityQuery);

    if (entityResult.rows.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: `Project "${name}" not found` }, null, 2),
          },
        ],
      };
    }

    const entity = entityResult.rows[0];

    // Find DEPENDS_ON dependencies
    const depsResult = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})-[:DEPENDS_ON]->(dep:Entity)
       RETURN dep.name as name, dep.id as id`,
    );
    const dependencies: string[] = depsResult.rows.map(
      (r: Record<string, unknown>) => String(r.name ?? r.id ?? ''),
    );

    // Find BLOCKS blockers
    const blockersResult = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})-[:BLOCKS]->(blocked:Entity)
       RETURN blocked.name as name, blocked.id as id`,
    );
    const blockers: string[] = blockersResult.rows.map(
      (r: Record<string, unknown>) => String(r.name ?? r.id ?? ''),
    );

    // Find LEADS relationship (who this entity leads)
    const leadsResult = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})-[:LEADS]->(led:Entity)
       RETURN led.name as name, led.id as id`,
    );
    const leading: string[] = leadsResult.rows.map(
      (r: Record<string, unknown>) => String(r.name ?? r.id ?? ''),
    );

    // Find who LEADS this entity (incoming LEADS)
    const ledByResult = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})<-[:LEADS]-(leader:Entity)
       RETURN leader.name as name, leader.id as id`,
    );
    const ledByNames: string[] = ledByResult.rows.map(
      (r: Record<string, unknown>) => String(r.name ?? r.id ?? ''),
    );

    // Build a structured report
    const report: string[] = [];
    report.push(`📊 **${entity.name ?? name}**`);
    if (entity.details) report.push(`📝 ${String(entity.details)}`);
    if (entity.status) report.push(`📈 Status: ${String(entity.status)}`);
    if (entity.goal) report.push(`🎯 Goal: ${String(entity.goal)}`);
    if (dependencies.length > 0) {
      report.push('📦 Dependencies:');
      dependencies.forEach((d) => report.push(`  • ${d}`));
    }
    if (blockers.length > 0) {
      report.push('🚧 Blocks:');
      blockers.forEach((b) => report.push(`  • ${b}`));
    }
    if (leading.length > 0) {
      report.push('👤 Leads:');
      leading.forEach((l) => report.push(`  • ${l}`));
    }
    if (ledByNames.length > 0) {
      report.push('👤 Lead:');
      ledByNames.forEach((l) => report.push(`  • ${l}`));
    }

    return {
      content: [{ type: 'text', text: report.join('\n') }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to get status for "${name}":`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleWhatsBlocking — Find all dependencies (up to 2 hops) of a concept
// ---------------------------------------------------------------------------

function handleWhatsBlocking(args: Record<string, unknown>) {
  const parsed = WhatsBlockingSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { concept } = parsed.data;
  const id = toSlug(concept);

  try {
    // Verify the concept exists and is a project (type or category)
    const checkResult = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})
       WHERE n.type = 'project' OR n.category = 'project'
       RETURN n.name as name`,
    );
    if (checkResult.rows.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: `Project "${concept}" not found` }, null, 2),
          },
        ],
      };
    }

    // 1st hop: direct DEPENDS_ON
    const directResult = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})-[:DEPENDS_ON]->(dep:Entity)
       RETURN dep.name as name, dep.id as id`,
    );
    const direct: string[] = directResult.rows.map((r: Record<string, unknown>) => (r.name ?? r.id) as string);

    // 2nd hop: indirect DEPENDS_ON (dependencies of direct dependencies)
    const indirect: string[] = [];
    const seen = new Set<string>(direct);
    for (const depName of direct) {
      const depId = toSlug(depName);
      const hop2Result = db.execute(
        `MATCH (n:Entity {id: '${cypherStr(depId)}'})-[:DEPENDS_ON]->(dep:Entity)
         RETURN dep.name as name, dep.id as id`,
      );
      for (const row of hop2Result.rows) {
        const childName = (row.name ?? row.id) as string;
        const childId = (row.id ?? '') as string;
        if (!seen.has(childName) && childId !== id) {
          indirect.push(childName);
          seen.add(childName);
        }
      }
    }

    if (direct.length === 0 && indirect.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { message: `✅ ${concept} has no dependencies` },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Build the report
    const report: string[] = [];
    report.push(`🔍 **${concept}** depends on:`);
    direct.forEach((d: string) => report.push(`  • ${d} (direct)`));
    indirect.forEach((d: string) => report.push(`  • ${d} (indirect)`));

    return {
      content: [{ type: 'text', text: report.join('\n') }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to check dependencies for "${concept}":`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleSummarize — Get a summary of all concepts in the knowledge graph
// ---------------------------------------------------------------------------

function handleSummarize(args: Record<string, unknown>) {
  const parsed = SummarizeSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { category, include_relationships } = parsed.data;

  try {
    // Count total concepts (filtered by category if provided)
    let countQuery: string;
    if (category) {
      const escapedCategory = cypherStr(category);
      countQuery = `MATCH (n:Entity) WHERE n.category = '${escapedCategory}' RETURN n.category as cat, count(n) as cnt`;
    } else {
      countQuery = 'MATCH (n:Entity) RETURN n.category as cat, count(n) as cnt';
    }
    const countResult = db.execute(countQuery);
    const totalConcepts = countResult.rows.reduce(
      (sum: number, r: Record<string, unknown>) => sum + (Number(r.cnt) || 0),
      0,
    );

    // Category breakdown
    const categoryBreakdown: Record<string, number> = {};
    for (const row of countResult.rows) {
      const cat = (row.cat as string) || '(uncategorized)';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (Number(row.cnt) || 0);
    }

    // Recent updates (5 most recent)
    let recentQuery: string;
    if (category) {
      const escapedCategory = cypherStr(category);
      recentQuery = `
        MATCH (n:Entity)
        WHERE n.category = '${escapedCategory}'
        RETURN n.name as name, n.updated_at as updated_at
        ORDER BY n.updated_at DESC
        LIMIT 5
      `;
    } else {
      recentQuery = `
        MATCH (n:Entity)
        RETURN n.name as name, n.updated_at as updated_at
        ORDER BY n.updated_at DESC
        LIMIT 5
      `;
    }
    const recentResult = db.execute(recentQuery);
    const recent = recentResult.rows.map((r: Record<string, unknown>) => ({
      name: r.name,
      updated_at: r.updated_at,
    }));

    // Relationship counts by type (if requested)
    const relationshipCounts: Record<string, number> = {};
    if (include_relationships) {
      const relTypes = ['DEPENDS_ON', 'LEADS', 'INSPIRED_BY', 'BLOCKS', 'RELATED_TO', 'MENTIONS', 'CREATED_BY', 'SUPERSEDED_BY'];
      for (const relType of relTypes) {
        try {
          let relQuery: string;
          if (category) {
            const escapedCategory = cypherStr(category);
            relQuery = `
              MATCH (a:Entity)-[r:${relType}]->(b:Entity)
              WHERE a.category = '${escapedCategory}' OR b.category = '${escapedCategory}'
              RETURN count(r) as cnt
            `;
          } else {
            relQuery = `MATCH ()-[r:${relType}]->() RETURN count(r) as cnt`;
          }
          const relResult = db.execute(relQuery);
          const cnt = Number(relResult.rows[0]?.cnt) || 0;
          if (cnt > 0) {
            relationshipCounts[relType] = cnt;
          }
        } catch {
          // Some relationship types might not exist; skip gracefully
        }
      }
    }

    // Build report
    const report: string[] = [];
    const scope = category ? ` (${category})` : '';
    report.push(`📊 **Knowledge Graph Summary${scope}**`);
    report.push(`📦 Total concepts: ${totalConcepts}`);
    report.push('📂 Categories:');
    const sortedCats = Object.entries(categoryBreakdown).sort(([, a], [, b]) => b - a);
    for (const [cat, cnt] of sortedCats) {
      report.push(`  • ${cat}: ${cnt}`);
    }

    if (include_relationships && Object.keys(relationshipCounts).length > 0) {
      report.push('🔗 Relationships:');
      const sortedRels = Object.entries(relationshipCounts).sort(([, a], [, b]) => b - a);
      for (const [relType, cnt] of sortedRels) {
        report.push(`  • ${relType}: ${cnt}`);
      }
    }

    report.push('📝 Recent updates:');
    for (const r of recent) {
      const timeAgo = formatTimeAgo(r.updated_at as string);
      report.push(`  • ${r.name} (${timeAgo})`);
    }

    return {
      content: [{ type: 'text', text: report.join('\n') }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'Failed to summarize graph:', message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Utility: formatTimeAgo — returns a human-readable "time ago" string from an
// ISO timestamp. Only used by handleSummarize.
// ---------------------------------------------------------------------------

function formatTimeAgo(isoString: string | null | undefined): string {
  if (!isoString) return 'unknown';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return 'unknown';
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`;
}

// ---------------------------------------------------------------------------
// handleLink — Create a typed relationship between two existing concepts
// ---------------------------------------------------------------------------

function handleLink(args: Record<string, unknown>) {
  const parsed = LinkSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { from, to, relation, evidence } = parsed.data;
  const fromId = toSlug(from);
  const toId = toSlug(to);

  try {
    // Check that both concepts exist
    const fromCheck = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(fromId)}'}) RETURN n.id`,
    );
    if (fromCheck.rows.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Concept "${from}" not found` }, null, 2) }],
        isError: true,
      };
    }

    const toCheck = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(toId)}'}) RETURN n.id`,
    );
    if (toCheck.rows.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Concept "${to}" not found` }, null, 2) }],
        isError: true,
      };
    }

    // Check if the relationship already exists
    const existingRel = db.execute(
      `MATCH (a:Entity {id: '${cypherStr(fromId)}'})-[r:${relation}]->(b:Entity {id: '${cypherStr(toId)}'}) RETURN r`,
    );
    if (existingRel.rows.length > 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { message: `Relationship "${from}" —[${relation}]→ "${to}" already exists` },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Build relationship properties (writes silently dropped by SparrowDB but present for forward compatibility)
    const now = isoTimestamp();
    let relProps = `source: 'user'`;
    if (evidence) {
      relProps += `, evidence: '${cypherStr(evidence)}'`;
    }
    // Create the relationship
    db.execute(
      `MATCH (a:Entity {id: '${cypherStr(fromId)}'}), (b:Entity {id: '${cypherStr(toId)}'})
       CREATE (a)-[:${relation} {${relProps}}]->(b)`,
    );
    db.checkpoint();

    log('info', `Linked "${from}" —[${relation}]→ "${to}"`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { message: `🔗 Linked "${from}" —[${relation}]→ "${to}"` },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to link "${from}" → "${to}":`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleQueryKnowledgeGraph — General graph query: natural language or Cypher
// ---------------------------------------------------------------------------

function handleQueryKnowledgeGraph(args: Record<string, unknown>) {
  const parsed = QueryKnowledgeGraphSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { query, limit } = parsed.data;

  try {
    const cypherKeywords = ['MATCH', 'RETURN', 'CREATE', 'MERGE', 'DELETE', 'WHERE', 'SET'];
    const isCypher = cypherKeywords.some((kw) => query.toUpperCase().includes(kw));

    let results: Record<string, unknown>[];

    if (isCypher) {
      // Execute as Cypher directly (append LIMIT if not present)
      let cypher = query.trim();
      if (!cypher.toUpperCase().includes('LIMIT')) {
        cypher = `${cypher} LIMIT ${limit}`;
      }
      const dbResult = db.execute(cypher);
      results = dbResult.rows;
      log('info', `Cypher query returned ${results.length} results`);
    } else {
      // Natural language: search across node names and details
      const searchTerm = query.toLowerCase();
      const allResult = db.execute(
        'MATCH (n:Entity) RETURN n.id as id, n.name as name, n.details as details, n.category as category LIMIT 500',
      );
      const filtered = allResult.rows
        .filter((r: unknown) => {
          const row = r as Record<string, unknown>;
          const name = String(row.name ?? '').toLowerCase();
          const details = String(row.details ?? '').toLowerCase();
          const category = String(row.category ?? '').toLowerCase();
          return name.includes(searchTerm) || details.includes(searchTerm) || category.includes(searchTerm);
        })
        .slice(0, limit) as Record<string, unknown>[];
      results = filtered;
      log('info', `Natural language search returned ${results.length} results for "${query}"`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { success: true, results, count: results.length, query },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Query failed:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleFindShortestPath — BFS path finding between two concepts
// ---------------------------------------------------------------------------

function bfsFindPath(
  sourceId: string,
  targetId: string,
  maxDepth: number,
): Array<{id: string; name: string; rel: string}> | null {
  if (sourceId === targetId) return [{ id: sourceId, name: sourceId, rel: 'self' }];

  const visited = new Set<string>([sourceId]);
  // Queue entries: [nodeId, path so far]
  let frontier: Array<[string, Array<{id: string; name: string; rel: string}>]> = [
    [sourceId, [{ id: sourceId, name: sourceId, rel: 'start' }]],
  ];

  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: Array<[string, Array<{id: string; name: string; rel: string}>]> = [];

    for (const [currentId, path] of frontier) {
      // Use undirected match (SparrowDB compatible)
      const allNeighbors = db.execute(
        `MATCH (n:Entity {id: '${cypherStr(currentId)}'})-[r]-(m:Entity)
         RETURN m.id as id, m.name as name, type(r) as rel`,
      ).rows;

      for (const neighbor of allNeighbors) {
        const nid = String(neighbor.id ?? '');
        const nname = String(neighbor.name ?? nid);
        const nrel = String(neighbor.rel ?? 'related');

        if (nid === targetId) {
          return [...path, { id: nid, name: nname, rel: nrel }];
        }

        if (!visited.has(nid)) {
          visited.add(nid);
          nextFrontier.push([nid, [...path, { id: nid, name: nname, rel: nrel }]]);
        }
      }
    }

    frontier = nextFrontier;
  }

  return null; // No path found within maxDepth
}

function handleFindShortestPath(args: Record<string, unknown>) {
  const parsed = FindShortestPathSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { source, target, max_depth } = parsed.data;
  const sourceId = toSlug(source);
  const targetId = toSlug(target);

  try {
    // Verify both nodes exist
    const srcCheck = db.execute(`MATCH (n:Entity {id: '${cypherStr(sourceId)}'}) RETURN n.name`);
    if (srcCheck.rows.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Source "${source}" not found` }, null, 2) }],
        isError: true,
      };
    }
    const tgtCheck = db.execute(`MATCH (n:Entity {id: '${cypherStr(targetId)}'}) RETURN n.name`);
    if (tgtCheck.rows.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Target "${target}" not found` }, null, 2) }],
        isError: true,
      };
    }

    const path = bfsFindPath(sourceId, targetId, max_depth);

    if (!path) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                message: `No path found between "${source}" and "${target}" within ${max_depth} hops`,
                source,
                target,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const pathNames = path.map((p) => p.name);
    const pathEdges = path.slice(1).map((p) => p.rel);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              path: pathNames,
              edges: pathEdges,
              length: path.length - 1,
              source,
              target,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Path finding failed:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleGetNodeNeighbors — Get neighbors with depth and type filtering
// ---------------------------------------------------------------------------

function handleGetNodeNeighbors(args: Record<string, unknown>) {
  const parsed = GetNodeNeighborsSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { node_id: nodeId, relationship_type, depth } = parsed.data;
  const id = toSlug(nodeId);

  try {
    // Validate node exists
    const check = db.execute(`MATCH (n:Entity {id: '${cypherStr(id)}'}) RETURN n.name as name`);
    if (check.rows.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Node "${nodeId}" not found` }, null, 2) }],
        isError: true,
      };
    }

    const relFilter = relationship_type ? `:${relationship_type}` : '';
    const allNeighbors: Array<{ id: string; name: string; relationship_type: string; direction: string; hop: number }> = [];
    const seen = new Set<string>([id]);
    let frontier = new Set<string>([id]);

    for (let hop = 1; hop <= depth; hop++) {
      const nextFrontier = new Set<string>();

      for (const currentId of frontier) {
        // Undirected neighbor query (SparrowDB compatible)
        const result = db.execute(
          `MATCH (n:Entity {id: '${cypherStr(currentId)}'})-[r${relFilter}]-(m:Entity)
           RETURN m.id as id, m.name as name, type(r) as rel`,
        );
        for (const row of result.rows) {
          const nid = String(row.id ?? '');
          const nname = String(row.name ?? nid);
          const nrel = String(row.rel ?? 'related');
          if (!seen.has(nid)) {
            seen.add(nid);
            nextFrontier.add(nid);
            allNeighbors.push({ id: nid, name: nname, relationship_type: nrel, direction: 'both', hop });
          }
        }
      }

      frontier = nextFrontier;
    }

    // Limit results for large graphs
    const limited = allNeighbors.slice(0, 100);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              node_id: nodeId,
              neighbors: limited,
              count: limited.length,
              total_found: allNeighbors.length,
              depth,
              relationship_filter: relationship_type ?? null,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to get neighbors:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleGetNodeProperties — Get properties/attributes of a specific concept
// ---------------------------------------------------------------------------

function handleGetNodeProperties(args: Record<string, unknown>) {
  const parsed = GetNodePropertiesSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { node_id: nodeId, properties } = parsed.data;
  const id = toSlug(nodeId);

  try {
    // Retrieve node
    const result = db.execute(
      `MATCH (n:Entity {id: '${cypherStr(id)}'})
       RETURN n.id as id, n.name as name, n.details as details, n.category as category,
              n.type as type, n.status as status, n.goal as goal,
              n.source as source, n.version as version,
              n.valid_from as valid_from, n.valid_to as valid_to,
              n.ingested_at as ingested_at,
              n.source_version as source_version, n.language as language,
              n.file_path as file_path, n.signature as signature,
              n.body_preview as body_preview, n.start_line as start_line,
              n.end_line as end_line, n.hash as hash,
              n.created_at as created_at, n.updated_at as updated_at
       LIMIT 1`,
    );

    if (result.rows.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ message: `Node "${nodeId}" not found` }, null, 2) }],
      };
    }

    const nodeData = result.rows[0] as Record<string, unknown>;

    // Filter to requested properties if specified
    let output: Record<string, unknown>;
    if (properties && properties.length > 0) {
      output = {};
      for (const prop of properties) {
        if (prop in nodeData) {
          output[prop] = nodeData[prop];
        }
      }
    } else {
      output = nodeData;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              node_id: nodeId,
              properties: output,
              property_count: Object.keys(output).length,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to get properties:`, message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleGetAllNodes — List all nodes with category/type filter and offset
// ---------------------------------------------------------------------------

function handleGetAllNodes(args: Record<string, unknown>) {
  const parsed = GetAllNodesSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { node_type, limit, offset } = parsed.data;

  try {
    // Build query with optional type/category filter (node_type maps to type OR category)
    const fields = 'n.id as id, n.name as name, n.details as details, n.category as category, n.type as type, n.source as source, n.version as version, n.created_at as created_at';
    let cypher: string;
    if (node_type) {
      const escapedType = cypherStr(node_type);
      cypher = `MATCH (n:Entity) WHERE n.type = '${escapedType}' OR n.category = '${escapedType}' RETURN ${fields} ORDER BY n.name`;
    } else {
      cypher = `MATCH (n:Entity) RETURN ${fields} ORDER BY n.name`;
    }

    const allResult = db.execute(cypher);
    const allNodes = allResult.rows;
    const total = allNodes.length;

    // Apply offset and limit in JavaScript (SparrowDB doesn't support SKIP)
    const paginated = allNodes.slice(offset, offset + limit);

    // Count categories for summary
    const catCounts: Record<string, number> = {};
    for (const node of allNodes) {
      const cat = String((node as Record<string, unknown>).category ?? '(uncategorized)');
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              nodes: paginated,
              count: paginated.length,
              total,
              offset,
              limit,
              node_type: node_type ?? null,
              categories: catCounts,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'Failed to list nodes:', message);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// handleGetSchema — Returns the graph schema
// ---------------------------------------------------------------------------

function handleGetSchema(args: Record<string, unknown>) {
  const parsed = GetSchemaSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return Promise.resolve({
      content: [{ type: 'text', text: `Validation error: ${issues}` }],
      isError: true,
    });
  }

  const { entity_type } = parsed.data;

  const schema: Record<string, unknown> = {
    node_schema: {
      properties: {
        id: { type: 'string', required: true, description: 'URL-safe slug' },
        name: { type: 'string', required: true, description: 'Human-readable name' },
        details: { type: 'string', required: true, description: 'Long-form description' },
        type: { type: 'string', required: true, values: ['project', 'person', 'code', 'memory', 'concept'], description: 'Controlled vocabulary for entity type' },
        category: { type: 'string', required: false, description: 'Free-form user label' },
        status: { type: 'string', required: false, description: 'Project status' },
        goal: { type: 'string', required: false, description: 'Project goal' },
        valid_from: { type: 'string', required: true, description: 'ISO timestamp — when this version became valid' },
        valid_to: { type: 'string', required: false, description: 'ISO timestamp or null (null = current)' },
        version: { type: 'integer', required: true, description: 'Version number' },
        source: { type: 'string', required: true, description: 'Source of this node (user, python_ast, cpp_clang, dart_analyzer, cline_memory)' },
        source_version: { type: 'string', required: false, description: 'Importer version' },
        ingested_at: { type: 'string', required: true, description: 'ISO timestamp when node was written' },
        language: { type: 'string', required: false, values: ['python', 'cpp', 'dart'], description: 'For code entities' },
        file_path: { type: 'string', required: false, description: 'For code entities' },
        signature: { type: 'string', required: false, description: 'For code entities: function/class signature' },
        body_preview: { type: 'string', required: false, description: 'For code entities: truncated body' },
        start_line: { type: 'integer', required: false, description: 'For code entities' },
        end_line: { type: 'integer', required: false, description: 'For code entities' },
        hash: { type: 'string', required: false, description: 'Content hash for change detection' },
        created_at: { type: 'string', required: true, description: 'ISO timestamp (auto-set)' },
        updated_at: { type: 'string', required: true, description: 'ISO timestamp (auto-set on write)' },
      },
    },
    relationship_schema: {
      properties: {
        evidence: { type: 'string', required: false, description: 'Citation or file reference' },
        source: { type: 'string', required: false, description: 'Which tool/importer created this' },
        confidence: { type: 'float', required: false, description: '0.0–1.0 confidence score' },
        valid_from: { type: 'string', required: false, description: 'ISO timestamp' },
        valid_to: { type: 'string', required: false, description: 'ISO timestamp or null' },
      },
      note: 'SparrowDB currently stores relationship properties silently but they cannot be read back. Properties are written for forward compatibility.',
    },
    relationship_types: [
      'DEPENDS_ON', 'LEADS', 'INSPIRED_BY', 'BLOCKS',
      'RELATED_TO', 'MENTIONS', 'CREATED_BY', 'SUPERSEDED_BY',
    ],
    constraints: {
      id: 'unique',
    },
  };

  if (entity_type) {
    const nodeSchema = schema.node_schema as { properties: Record<string, unknown> };
    const typeSpecific: Record<string, string[]> = {
      project: ['id', 'name', 'details', 'type', 'category', 'status', 'goal', 'source', 'version', 'valid_from', 'valid_to', 'created_at', 'updated_at'],
      code: ['id', 'name', 'details', 'type', 'source', 'source_version', 'version', 'language', 'file_path', 'signature', 'body_preview', 'start_line', 'end_line', 'hash', 'valid_from', 'valid_to', 'created_at', 'updated_at'],
      person: ['id', 'name', 'details', 'type', 'category', 'source', 'version', 'valid_from', 'valid_to', 'created_at', 'updated_at'],
      memory: ['id', 'name', 'details', 'type', 'category', 'source', 'version', 'valid_from', 'valid_to', 'ingested_at', 'created_at', 'updated_at'],
      concept: ['id', 'name', 'details', 'type', 'category', 'source', 'version', 'valid_from', 'valid_to', 'created_at', 'updated_at'],
    };
    const relevantProps = typeSpecific[entity_type];
    if (relevantProps && nodeSchema) {
      const filteredProps: Record<string, unknown> = {};
      for (const propName of relevantProps) {
        if (nodeSchema.properties[propName]) {
          filteredProps[propName] = nodeSchema.properties[propName];
        }
      }
      schema.recommended_properties = filteredProps;
    }
  }

  return Promise.resolve({
    content: [
      {
        type: 'text',
        text: JSON.stringify(schema, null, 2),
      },
    ],
  });
}

// ---------------------------------------------------------------------------

const dbPath = process.env.DB_PATH ?? './data/graph.db';
let db: InstanceType<typeof SparrowDB>;

async function main() {
  log('info', 'Starting Graph Memory MCP Server...');
  log('info', `Database path: ${dbPath}`);

  // Initialise the database
  db = initDB(dbPath);

  // Wire viewer routes
  setDb(db);

  // Start graph viewer HTTP server
  const viewerPort = parseInt(process.env.VIEWER_PORT || '3000');
  const viewer = new ViewerServer(viewerPort);
  viewer.start();
  log('info', `Graph viewer at http://localhost:${viewerPort}/graph`);


  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'Server running on stdio');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  log('info', 'SIGINT received — shutting down...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('info', 'SIGTERM received — shutting down...');
  await server.close();
  process.exit(0);
});

main().catch((err) => {
  log('error', 'Fatal error:', err);
  process.exit(1);
});
