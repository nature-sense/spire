#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VSCodeBridge } from './vscode-bridge.js';
import {
  EditorContext,
  DiagnosticsResult,
  SymbolResult,
} from './types.js';

// Get socket path from environment or use default
const socketPath = process.env.VSCODE_IPC_PATH;

const bridge = new VSCodeBridge(socketPath);
const server = new McpServer({
  name: '@spire/vsc-bridge-mcp',
  version: '0.1.0',
});

// Tool: get_editor_context
server.tool(
  'get_editor_context',
  {},
  async () => {
    try {
      const result = await bridge.sendRequest('getContext', {}) as EditorContext;
      return {
        content: [
          {
            type: 'text',
            text: formatEditorContext(result),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool: open_file
server.tool(
  'open_file',
  {
    path: z.string().describe('Absolute or workspace-relative path to the file'),
    line: z.number().optional().describe('Line number (1-based)'),
    column: z.number().optional().describe('Column number (1-based)'),
  },
  async (params) => {
    try {
      await bridge.sendRequest('openFile', params);
      let msg = `Opened ${params.path}`;
      if (params.line) {
        msg += ` at line ${params.line}`;
        if (params.column) msg += `, column ${params.column}`;
      }
      return {
        content: [{ type: 'text', text: msg }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool: get_diagnostics
server.tool(
  'get_diagnostics',
  {
    path: z.string().optional().describe('Optional file path filter'),
  },
  async (params) => {
    try {
      const result = await bridge.sendRequest('getDiagnostics', params) as DiagnosticsResult;
      return {
        content: [
          {
            type: 'text',
            text: formatDiagnostics(result),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool: show_notification
server.tool(
  'show_notification',
  {
    message: z.string().describe('Notification message to display'),
    type: z
      .enum(['info', 'warning', 'error'])
      .optional()
      .default('info')
      .describe('Notification type'),
  },
  async (params) => {
    try {
      await bridge.sendRequest('showNotification', params);
      return {
        content: [{ type: 'text', text: `Notification shown: ${params.message}` }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool: show_input_box
server.tool(
  'show_input_box',
  {
    prompt: z.string().describe('Prompt text displayed in the input box'),
    value: z.string().optional().describe('Default value'),
    placeHolder: z.string().optional().describe('Placeholder text'),
    password: z.boolean().optional().default(false).describe('Whether input is a password'),
  },
  async (params) => {
    try {
      const result = await bridge.sendRequest('showInputBox', params) as { value: string | undefined };
      if (result.value === undefined) {
        return {
          content: [{ type: 'text', text: 'Input was cancelled' }],
        };
      }
      return {
        content: [{ type: 'text', text: result.value }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool: run_command
server.tool(
  'run_command',
  {
    command: z.string().describe('VS Code command ID to execute'),
    args: z.array(z.any()).optional().describe('Command arguments'),
  },
  async (params) => {
    try {
      const result = await bridge.sendRequest('runCommand', params);
      return {
        content: [
          {
            type: 'text',
            text: `Command executed: ${params.command}\nResult: ${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Tool: search_symbols
server.tool(
  'search_symbols',
  {
    query: z.string().describe('Symbol name or pattern to search for'),
  },
  async (params) => {
    try {
      const result = await bridge.sendRequest('searchSymbols', params) as SymbolResult[];
      return {
        content: [
          {
            type: 'text',
            text: formatSymbols(result),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
);

// Helper formatting functions
function formatEditorContext(ctx: EditorContext): string {
  const lines: string[] = ['## Editor Context'];

  if (!ctx.activeFile) {
    lines.push('No active editor.');
    return lines.join('\n');
  }

  lines.push(`**Active File:** ${ctx.activeFile}`);
  lines.push(`**Language:** ${ctx.languageId || 'unknown'}`);
  lines.push(`**Cursor:** Line ${ctx.cursorLine}, Column ${ctx.cursorColumn}`);

  if (ctx.selectionText) {
    lines.push(`**Selection:** Lines ${ctx.selectionStartLine}-${ctx.selectionEndLine}`);
    lines.push('```');
    lines.push(ctx.selectionText);
    lines.push('```');
  }

  if (ctx.workspaceRoot) {
    lines.push(`**Workspace Root:** ${ctx.workspaceRoot}`);
  }

  if (ctx.openFiles.length > 0) {
    lines.push(`**Open Files (${ctx.openFiles.length}):**`);
    for (const file of ctx.openFiles) {
      lines.push(`  - ${file}`);
    }
  }

  return lines.join('\n');
}

function formatDiagnostics(result: DiagnosticsResult): string {
  if (result.total === 0) {
    return 'No diagnostics found.';
  }

  const lines: string[] = [`## Diagnostics (${result.total} total)`];

  for (const [filePath, diagnostics] of Object.entries(result.files)) {
    lines.push(`\n### ${filePath}`);
    for (const d of diagnostics) {
      const loc = `${d.range.startLine}:${d.range.startColumn}`;
      lines.push(`- [${d.severity.toUpperCase()}] ${loc}: ${d.message}`);
      if (d.code) lines.push(`  Code: ${d.code}`);
      if (d.source) lines.push(`  Source: ${d.source}`);
    }
  }

  return lines.join('\n');
}

function formatSymbols(symbols: SymbolResult[]): string {
  if (symbols.length === 0) {
    return 'No symbols found.';
  }

  const lines: string[] = [`## Symbols (${symbols.length} found)`];

  for (const s of symbols) {
    lines.push(
      `- **${s.name}** (${s.kind}) — ${s.filePath}:${s.line}:${s.column}` +
        (s.containerName ? ` [in ${s.containerName}]` : ''),
    );
  }

  return lines.join('\n');
}

// Main entry point
async function main() {
  console.error('[vsc-bridge-mcp] Starting MCP server...');

  // Wait for VS Code extension to be ready, then connect
  try {
    console.error('[vsc-bridge-mcp] Waiting for VS Code extension...');
    await bridge.waitForExtension();
    await bridge.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vsc-bridge-mcp] Connection failed: ${message}`);
    console.error('[vsc-bridge-mcp] Starting in degraded mode - tools will return errors until connection is established');
    // Don't exit - let the MCP server start so the client can still get error messages
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[vsc-bridge-mcp] MCP server running on stdio');
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.error('[vsc-bridge-mcp] Shutting down...');
  bridge.disconnect();
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[vsc-bridge-mcp] Shutting down...');
  bridge.disconnect();
  await server.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('[vsc-bridge-mcp] Fatal error:', err);
  process.exit(1);
});
