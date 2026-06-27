#!/usr/bin/env node

/**
 * mcp-process — MCP server for starting, managing, and interacting with
 * long-running processes.
 *
 * Tools:
 *   - start_process        Start a new process with output streaming
 *   - process_send_stdin   Send input to a running process
 *   - process_kill         Stop a running process
 *   - process_get_output   Get captured output from a running process
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessInfo {
  id: string;
  pid: number;
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
  startTime: number;
  command: string;
  status: 'running' | 'exited' | 'error';
  exitCode?: number;
  timeout?: NodeJS.Timeout;
}

interface StartProcessOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: boolean;
}

// ---------------------------------------------------------------------------
// Process Manager
// ---------------------------------------------------------------------------

class ProcessManager extends EventEmitter {
  private processes = new Map<string, ProcessInfo>();
  private maxOutputLines = 1000;

  async startProcess(options: StartProcessOptions): Promise<{
    processId: string;
    pid: number;
    status: 'running' | 'exited' | 'error';
    startTime: number;
  }> {
    const id = this.generateId();
    const [cmd, ...args] = options.command.split(' ');

    const proc = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      shell: options.shell !== false,
      detached: false,
    });

    const processInfo: ProcessInfo = {
      id,
      pid: proc.pid || 0,
      process: proc,
      stdout: [],
      stderr: [],
      startTime: Date.now(),
      command: options.command,
      status: 'running',
    };

    this.processes.set(id, processInfo);

    // Capture stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      this.captureOutput(id, 'stdout', lines);
      this.emit('output', { id, type: 'stdout', lines });
    });

    // Capture stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      this.captureOutput(id, 'stderr', lines);
      this.emit('output', { id, type: 'stderr', lines });
    });

    // Handle process exit
    proc.on('close', (code: number | null) => {
      const info = this.processes.get(id);
      if (info) {
        info.status = 'exited';
        info.exitCode = code ?? undefined;
        if (info.timeout) {
          clearTimeout(info.timeout);
        }
        this.emit('exit', { id, code });
      }
    });

    // Handle spawn errors
    proc.on('error', (error: Error) => {
      const info = this.processes.get(id);
      if (info) {
        info.status = 'error';
        this.emit('error', { id, error: error.message });
      }
    });

    // Set timeout
    if (options.timeout && options.timeout > 0) {
      const timeout = setTimeout(() => {
        this.killProcess(id, 'SIGTERM');
        this.emit('timeout', { id, timeout: options.timeout });
      }, options.timeout);

      processInfo.timeout = timeout;
    }

    return {
      processId: id,
      pid: proc.pid || 0,
      status: 'running',
      startTime: processInfo.startTime,
    };
  }

  async sendStdin(
    processId: string,
    input: string,
    newline: boolean = true,
  ): Promise<void> {
    const info = this.processes.get(processId);
    if (!info) {
      throw new Error(`Process ${processId} not found`);
    }

    if (info.status !== 'running') {
      throw new Error(
        `Process ${processId} is not running (status: ${info.status})`,
      );
    }

    info.process.stdin?.write(input + (newline ? '\n' : ''));
  }

  async killProcess(
    processId: string,
    signal: string = 'SIGTERM',
  ): Promise<{ processId: string; status: string }> {
    const info = this.processes.get(processId);
    if (!info) {
      throw new Error(`Process ${processId} not found`);
    }

    if (info.status !== 'running') {
      throw new Error(
        `Process ${processId} is not running (status: ${info.status})`,
      );
    }

    info.process.kill(signal as any);
    info.status = 'exited';

    return { processId, status: 'exited' };
  }

  getOutput(
    processId: string,
    options: { tail?: number; since?: number } = {},
  ): { stdout: string[]; stderr: string[]; totalLines: number } {
    const info = this.processes.get(processId);
    if (!info) {
      throw new Error(`Process ${processId} not found`);
    }

    let stdout = info.stdout;
    let stderr = info.stderr;

    // Filter by timestamp (approximate: only applies to currently stored lines)
    if (options.since) {
      // We store startTime per process, but individual line timestamps
      // are not tracked. If 'since' is before process start, return all.
      if (options.since > info.startTime) {
        // Cannot reliably filter by line timestamp, so return empty
        // as we don't store per-line timestamps.
        stdout = [];
        stderr = [];
      }
    }

    // Tail the output
    if (options.tail && options.tail > 0) {
      stdout = stdout.slice(-options.tail);
      stderr = stderr.slice(-options.tail);
    }

    return {
      stdout,
      stderr,
      totalLines: info.stdout.length + info.stderr.length,
    };
  }

  listProcesses(): Array<{
    id: string;
    pid: number;
    command: string;
    status: string;
    startTime: number;
  }> {
    return Array.from(this.processes.values()).map((info) => ({
      id: info.id,
      pid: info.pid,
      command: info.command,
      status: info.status,
      startTime: info.startTime,
    }));
  }

  getProcess(processId: string): ProcessInfo | undefined {
    return this.processes.get(processId);
  }

  private captureOutput(
    id: string,
    type: 'stdout' | 'stderr',
    lines: string[],
  ) {
    const info = this.processes.get(id);
    if (!info) return;

    const target = type === 'stdout' ? info.stdout : info.stderr;
    target.push(...lines);

    // Limit output storage
    if (target.length > this.maxOutputLines) {
      target.splice(0, target.length - this.maxOutputLines);
    }
  }

  private generateId(): string {
    return randomBytes(8).toString('hex');
  }

  cleanup(): void {
    for (const [id, info] of this.processes) {
      if (info.status === 'running') {
        info.process.kill('SIGKILL');
      }
      if (info.timeout) {
        clearTimeout(info.timeout);
      }
    }
    this.processes.clear();
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const processManager = new ProcessManager();

const server = new Server(
  {
    name: 'mcp-process',
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
      name: 'start_process',
      description:
        'Start a new process and get a process ID for management. Streams stdout/stderr and supports timeout, working directory, and environment variables.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Full command to execute (e.g. "npm run build")',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the process',
          },
          env: {
            type: 'object',
            description: 'Environment variables to set for the process',
            additionalProperties: { type: 'string' },
          },
          timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds. Process is killed with SIGTERM if it exceeds this.',
          },
          shell: {
            type: 'boolean',
            description: 'Use shell to execute the command (default: true)',
            default: true,
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'process_send_stdin',
      description: 'Send input to a running process via its stdin.',
      inputSchema: {
        type: 'object',
        properties: {
          processId: {
            type: 'string',
            description: 'Process ID returned from start_process',
          },
          input: {
            type: 'string',
            description: 'Text input to send to the process',
          },
          newline: {
            type: 'boolean',
            description: 'Append a newline to the input (default: true)',
            default: true,
          },
        },
        required: ['processId', 'input'],
      },
    },
    {
      name: 'process_kill',
      description: 'Stop a running process by sending a signal.',
      inputSchema: {
        type: 'object',
        properties: {
          processId: {
            type: 'string',
            description: 'Process ID returned from start_process',
          },
          signal: {
            type: 'string',
            description: 'Signal to send. One of SIGTERM, SIGINT, or SIGKILL (default: SIGTERM)',
            enum: ['SIGTERM', 'SIGINT', 'SIGKILL'],
            default: 'SIGTERM',
          },
        },
        required: ['processId'],
      },
    },
    {
      name: 'process_get_output',
      description:
        'Get captured stdout/stderr output from a running or completed process.',
      inputSchema: {
        type: 'object',
        properties: {
          processId: {
            type: 'string',
            description: 'Process ID returned from start_process',
          },
          tail: {
            type: 'integer',
            description: 'Number of most recent lines to return from each stream',
          },
          since: {
            type: 'integer',
            description: 'Only return output captured after this timestamp (Unix ms). Note: per-line timestamps are not tracked; returns all output if timestamp is before process start, or empty otherwise.',
          },
        },
        required: ['processId'],
      },
    },
  ],
}));

// ── CallTool ───────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'start_process': {
        if (!args || typeof args.command !== 'string') {
          throw new Error('Missing required parameter: command (string)');
        }

        const result = await processManager.startProcess({
          command: args.command,
          cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
          env:
            args.env && typeof args.env === 'object'
              ? (args.env as Record<string, string>)
              : undefined,
          timeout:
            typeof args.timeout === 'number' ? args.timeout : undefined,
          shell:
            args.shell === undefined || args.shell === true ? true : false,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'process_send_stdin': {
        if (!args || typeof args.processId !== 'string' || typeof args.input !== 'string') {
          throw new Error(
            'Missing required parameters: processId (string) and input (string)',
          );
        }

        await processManager.sendStdin(
          args.processId,
          args.input,
          args.newline !== false,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, processId: args.processId }, null, 2),
            },
          ],
        };
      }

      case 'process_kill': {
        if (!args || typeof args.processId !== 'string') {
          throw new Error('Missing required parameter: processId (string)');
        }

        const signal =
          typeof args.signal === 'string' ? args.signal : 'SIGTERM';
        const result = await processManager.killProcess(args.processId, signal);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'process_get_output': {
        if (!args || typeof args.processId !== 'string') {
          throw new Error('Missing required parameter: processId (string)');
        }

        const result = processManager.getOutput(args.processId, {
          tail: typeof args.tail === 'number' ? args.tail : undefined,
          since: typeof args.since === 'number' ? args.since : undefined,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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
  console.error('[mcp-process] Starting server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-process] Server running on stdio');
}

process.on('SIGINT', async () => {
  console.error('[mcp-process] Shutting down...');
  processManager.cleanup();
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[mcp-process] Shutting down...');
  processManager.cleanup();
  await server.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('[mcp-process] Fatal error:', err);
  process.exit(1);
});
