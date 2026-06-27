#!/usr/bin/env node

/**
 * mcp-search — MCP server for grep-like content search across files.
 *
 * Tool: search_content
 *   - Regex or plain-text pattern matching
 *   - Case sensitivity toggle
 *   - Context lines (before / after)
 *   - Glob include / exclude filtering
 *   - Streaming read for large files
 *   - Structured JSON output
 */

import fg from 'fast-glob';
import { createReadStream, statSync } from 'fs';
import readline from 'readline';
import { join, isAbsolute, relative, resolve } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  file: string;
  line: number;
  content: string;
  context: {
    before: string[];
    after: string[];
  };
}

interface SearchOptions {
  pattern: string;
  path: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  include?: string[];
  exclude?: string[];
  maxResults?: number;
}

interface SearchOutput {
  results: SearchResult[];
  totalMatches: number;
  searchTime: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape special regex characters in a plain-text pattern */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Default glob patterns to ignore — avoids huge / binary dirs */
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/*.log',
  '**/*.min.js',
  '**/*.min.css',
  '**/vendor/**',
  '**/.DS_Store',
];

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

async function resolveFiles(
  rootPath: string,
  include?: string[],
  exclude?: string[],
): Promise<string[]> {
  // If the path is a regular file, return it directly
  try {
    const st = statSync(rootPath);
    if (st.isFile()) {
      return [rootPath];
    }
  } catch {
    // stat failed — let fast-glob try
  }

  const globPatterns = include && include.length > 0 ? include : ['**/*'];
  const ignorePatterns = exclude && exclude.length > 0 ? exclude : DEFAULT_EXCLUDE;

  const files = await fg(globPatterns, {
    cwd: rootPath,
    ignore: ignorePatterns,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  });

  return files;
}

// ---------------------------------------------------------------------------
// Core search
// ---------------------------------------------------------------------------

/**
 * Search a single file line-by-line, collecting before context as we go.
 * After a match we peek ahead up to `contextLines` to fill the `after` array.
 */
async function searchFile(
  filePath: string,
  pattern: RegExp,
  contextLines: number,
  results: SearchResult[],
  maxResults: number,
): Promise<void> {
  const lines: string[] = [];
  const lineNums: number[] = [];

  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (results.length >= maxResults) break;

      lines.push(line);
      lineNums.push(lines.length);

      pattern.lastIndex = 0; // reset for global regex
      if (pattern.test(line)) {
        const currentLineNum = lines.length;

        // before context: last N lines before this match
        const beforeStart = Math.max(0, lines.length - contextLines - 1);
        const before = lines.slice(beforeStart, lines.length - 1);

        // We'll fill after context later by reading ahead
        results.push({
          file: filePath,
          line: currentLineNum,
          content: line,
          context: {
            before,
            after: [],
          },
        });
      }
    }
  } catch {
    // Skip files that can't be read (binary, permissions, etc.)
    stream.destroy();
    return;
  }

  // Second pass: fill `after` context for each result by scanning forward
  if (contextLines > 0) {
    for (const result of results) {
      if (result.file !== filePath) continue;
      const startIdx = result.line; // 1-based
      const endIdx = Math.min(lines.length, startIdx + contextLines);
      result.context.after = lines.slice(startIdx, endIdx);
    }
  }
}

/**
 * Main search entry point.
 */
async function searchContent(options: SearchOptions): Promise<SearchOutput> {
  const startTime = Date.now();

  // Validate path
  if (!options.path) {
    throw new Error('path is required');
  }

  // Build regex from pattern
  const flags = options.caseSensitive ? 'g' : 'gi';
  const pattern = options.regex
    ? new RegExp(options.pattern, flags)
    : new RegExp(escapeRegExp(options.pattern), flags);

  const contextLines = options.contextLines ?? 0;
  const maxResults = options.maxResults ?? 100;

  // Resolve files to search
  const files = await resolveFiles(options.path, options.include, options.exclude);

  if (files.length === 0) {
    return { results: [], totalMatches: 0, searchTime: Date.now() - startTime };
  }

  // Search each file
  const allResults: SearchResult[] = [];

  for (const file of files) {
    if (allResults.length >= maxResults) break;
    await searchFile(file, pattern, contextLines, allResults, maxResults);
  }

  return {
    results: allResults,
    totalMatches: allResults.length,
    searchTime: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: 'mcp-search',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ── ListTools ──────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_content',
      description:
        'Search for patterns in files (grep-like). Supports regex, case sensitivity, context lines, and glob include/exclude filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Search pattern (plain text or regex)',
          },
          path: {
            type: 'string',
            description: 'Directory or file path to search within',
          },
          regex: {
            type: 'boolean',
            description: 'Treat pattern as regex',
            default: false,
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Case-sensitive matching',
            default: false,
          },
          contextLines: {
            type: 'integer',
            description: 'Number of context lines before and after each match',
            default: 0,
          },
          include: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Glob patterns to include (e.g. ["**/*.ts", "**/*.js"]). Defaults to all files.',
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Glob patterns to exclude (e.g. ["**/test/**"]). Defaults exclude node_modules, .git, dist, build, etc.',
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum number of results to return',
            default: 100,
          },
        },
        required: ['pattern', 'path'],
      },
    },
  ],
}));

// ── CallTool ───────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== 'search_content') {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Validate required args
  if (!args || typeof args.pattern !== 'string' || typeof args.path !== 'string') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { error: 'Missing required parameters: pattern (string) and path (string)' },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await searchContent({
      pattern: args.pattern,
      path: args.path,
      regex: args.regex === true,
      caseSensitive: args.caseSensitive === true,
      contextLines: typeof args.contextLines === 'number' ? args.contextLines : 0,
      include: Array.isArray(args.include) ? args.include : undefined,
      exclude: Array.isArray(args.exclude) ? args.exclude : undefined,
      maxResults: typeof args.maxResults === 'number' ? args.maxResults : 100,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error('[mcp-search] Starting server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-search] Server running on stdio');
}

process.on('SIGINT', async () => {
  console.error('[mcp-search] Shutting down...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[mcp-search] Shutting down...');
  await server.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('[mcp-search] Fatal error:', err);
  process.exit(1);
});
