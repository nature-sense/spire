#!/usr/bin/env node

/**
 * Spire Embedded Terminal MCP Server
 *
 * Provides a safe, sandboxed shell command execution tool for the Spire VS Code
 * extension. Designed to run under VS Code's embedded Node.js runtime
 * (ELECTRON_RUN_AS_NODE=1).
 *
 * Exposed tools:
 *   - execute_command: Run a shell command, returns { stdout, stderr, exitCode }
 *   - get_environment: Get basic metadata (shell, cwd, platform)
 *
 * Security notes:
 *   - Commands are run via the system shell (SHELL or /bin/sh)
 *   - Working directory defaults to the workspace root (passed as --cwd arg)
 *   - No interactive commands (stdin is closed)
 *   - Output is capped to prevent runaway logging
 */

import { spawn, SpawnOptions } from 'child_process';
import path from 'path';

// ── Constants ────────────────────────────────────────────────────────

const MAX_OUTPUT_LENGTH = 1024 * 64; // 64 KB per command
const DEFAULT_TIMEOUT_MS = 60_000;
const CAPTURE_TIMEOUT_MS = 30_000;

// ── CLI argument: workspace root ─────────────────────────────────────

function parseArgs(): { cwd: string } {
  const cwdIndex = process.argv.indexOf('--cwd');
  const cwd = cwdIndex !== -1 && process.argv[cwdIndex + 1]
    ? path.resolve(process.argv[cwdIndex + 1])
    : process.cwd();
  return { cwd };
}

// ── MCP Protocol helpers ─────────────────────────────────────────────

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

let requestId = 1;

function sendMessage(msg: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendError(id: number | undefined, code: number, message: string): void {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendResult(id: number, result: unknown): void {
  sendMessage({ jsonrpc: '2.0', id, result });
}

// ── Tool implementations ─────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

function executeShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/sh';
    const options: SpawnOptions = {
      cwd,
      shell,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    };

    const child = spawn(command, [], options);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Give it a moment, then SIGKILL
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000);
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) +
          `\n... (truncated at ${MAX_OUTPUT_LENGTH} characters)`;
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: `Failed to start command: ${err.message}`,
        exitCode: -1,
        timedOut: false,
      });
    });
  });
}

// ── Tool definitions ─────────────────────────────────────────────────

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

const tools: ToolDefinition[] = [
  {
    name: 'execute_command',
    description: `Run a shell command on the local machine and capture its output.

Returns the combined stdout, stderr, and exit code. The command runs in the
workspace root directory via the system shell (SHELL or /bin/sh).

- stdin is not available (must be non-interactive commands)
- Output is capped at 64 KB
- Default timeout is 60 seconds
- Use \`cd\` inside your command if you need a different working directory`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (non-interactive)',
        },
        timeout: {
          type: 'number',
          description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
        },
      },
      required: ['command'],
    },
    handler: async (params) => {
      const command = params.command as string;
      const timeout = (params.timeout as number) ?? DEFAULT_TIMEOUT_MS;
      const cwd = parseArgs().cwd;

      if (!command || typeof command !== 'string') {
        return { error: 'Missing required parameter: "command"' };
      }

      const result = await executeShellCommand(command, cwd, timeout);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
    },
  },
  {
    name: 'get_environment',
    description: `Returns metadata about the execution environment: the system shell,
the current working directory, the platform (darwin/linux/win32), and
whether common tools like git, node, docker, etc. are available on PATH.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const { cwd } = parseArgs();
      return {
        shell: process.env.SHELL || '/bin/sh',
        cwd,
        platform: process.platform,
        arch: process.arch,
        commonTools: {
          git: await toolExists('git --version'),
          node: await toolExists('node --version'),
          npm: await toolExists('npm --version'),
          docker: await toolExists('docker --version'),
          python: await toolExists('python3 --version') || await toolExists('python --version'),
        },
      };
    },
  },
];

async function toolExists(checkCommand: string): Promise<boolean> {
  try {
    const result = await executeShellCommand(checkCommand, parseArgs().cwd, 5_000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ── MCP initialize / startup ─────────────────────────────────────────

function handleInitialize(id: number, _params: unknown): void {
  sendResult(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'spire-terminal-server',
      version: '1.0.0',
    },
  });
}

function handleListTools(id: number): void {
  const toolList = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  sendResult(id, { tools: toolList });
}

async function handleCallTool(id: number, params: Record<string, unknown>): Promise<void> {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    sendError(id, -32601, `Tool not found: "${name}"`);
    return;
  }

  try {
    const result = await tool.handler(args);
    const text = JSON.stringify(result, null, 2);
    sendResult(id, {
      content: [{ type: 'text', text }],
    });
  } catch (err) {
    sendError(id, -32603, `Tool execution failed: ${(err as Error).message}`);
  }
}

// ── Main loop ────────────────────────────────────────────────────────

let initialized = false;
let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    const id = msg.id;
    const method = msg.method;
    const params = msg.params ?? {};

    // Initialize is the only method allowed before handshake
    if (!initialized && method !== 'initialize') {
      sendError(id, -32000, 'Server not initialized. Send "initialize" first.');
      continue;
    }

    switch (method) {
      case 'initialize':
        initialized = true;
        handleInitialize(id!, params);
        break;

      case 'tools/list':
        handleListTools(id!);
        break;

      case 'tools/call':
        handleCallTool(id!, params);
        break;

      case 'notifications/initialized':
        // Acknowledge but no response needed for notifications
        break;

      default:
        sendError(id, -32601, `Method not found: "${method}"`);
        break;
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

// Signal that the server is ready (stderr so it doesn't interfere with stdout JSON-RPC)
console.error('[spire-terminal-server] Ready');
