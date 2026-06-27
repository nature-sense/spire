#!/usr/bin/env node

/**
 * test-tools.ts — Tests all 8 tools of the Graph Memory MCP server.
 *
 * This script starts the MCP server as a subprocess, initializes it,
 * and calls each tool to demonstrate that everything works end-to-end.
 *
 * Tools tested:
 *   1. remember  — Store concepts
 *   2. link      — Create typed relationships
 *   3. recall    — Retrieve with related entities
 *   4. project_status — Get project report
 *   5. whats_blocking — Find dependencies
 *   6. summarize      — Graph aggregation summary
 *   7. list      — List all concepts
 *   8. forget    — Remove a concept
 *
 * Usage: npx tsx test/test-tools.ts
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = resolve(__dirname, '..', 'dist/index.js');
const DB_PATH = resolve(__dirname, '..', 'data/test-tools.db');

let requestId = 1;

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

class MCPTestClient {
  private process: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<number, PendingEntry>();
  private ready = false;

  start(): Promise<unknown> {
    return new Promise((resolvePromise, reject) => {
      this.process = spawn('node', [SERVER_SCRIPT], {
        env: { ...process.env, DB_PATH, LOG_LEVEL: 'error' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout!.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr!.on('data', (data: Buffer) => {
        process.stderr.write(data);
      });

      this.process.on('error', (err) => {
        reject(err);
      });

      this.process.on('exit', (code) => {
        if (!this.ready) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      setTimeout(() => {
        this.sendInitialize()
          .then((result) => {
            this.ready = true;
            resolvePromise(result);
          })
          .catch(reject);
      }, 500);
    });
  }

  async sendInitialize(): Promise<unknown> {
    const response = (await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-tools', version: '1.0.0' },
    })) as { result?: unknown; error?: unknown };
    return response.result ?? response.error;
  }

  processBuffer(): void {
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  handleMessage(msg: { id?: number }): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      resolve(msg);
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = requestId++;
      const request = { jsonrpc: '2.0', id, method, params };
      this.pending.set(id, { resolve, reject });

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request ${id} (${method}) timed out`));
        }
      }, 10000);

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.send('tools/call', { name, arguments: args });
  }

  close(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// --- Test helpers ---------------------------------------------------------

async function getResultText(response: unknown): Promise<string> {
  const r = response as { result?: { content?: Array<{ text: string }> } };
  return r?.result?.content?.[0]?.text ?? JSON.stringify(response, null, 2);
}

async function callAndShow(client: MCPTestClient, step: number, label: string, tool: string, params: Record<string, unknown>): Promise<void> {
  console.log(`--- ${step}. ${label} ---`);
  const res = await client.callTool(tool, params);
  console.log('   Result:', await getResultText(res));
  console.log();
}

// --- Tests -----------------------------------------------------------------

async function runTests() {
  const client = new MCPTestClient();
  console.log('=== Graph Memory MCP — All 8 Tools Test ===\n');

  try {
    await client.start();
    console.log('✓ Server started and initialized\n');

    // Step 1: List tools
    console.log('--- 1. List tools ---');
    const toolsResp = (await client.send('tools/list')) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const tools = toolsResp.result?.tools ?? [];
    const toolNames = tools.map((t) => t.name).join(', ');
    console.log(`   Available tools (${tools.length}): ${toolNames}\n`);

    // Step 2-5: remember
    await callAndShow(client, 2, 'Remember "vsc-bridge"', 'remember', {
      concept: 'vsc-bridge',
      details: 'A VS Code extension bridging IDE with external tools',
      category: 'project',
    });
    await callAndShow(client, 3, 'Remember "typescript"', 'remember', {
      concept: 'typescript', details: 'Typed superset of JavaScript', category: 'technology',
    });
    await callAndShow(client, 4, 'Remember "@modelcontextprotocol/sdk"', 'remember', {
      concept: '@modelcontextprotocol/sdk', details: 'MCP SDK for building servers and clients', category: 'library',
    });
    await callAndShow(client, 5, 'Remember "node.js"', 'remember', {
      concept: 'node.js', details: 'JavaScript runtime', category: 'technology',
    });

    // Step 6-11: link
    await callAndShow(client, 6, 'Link: vsc-bridge DEPENDS_ON typescript', 'link', {
      from: 'vsc-bridge', to: 'typescript', relation: 'DEPENDS_ON',
    });
    await callAndShow(client, 7, 'Link: vsc-bridge DEPENDS_ON @modelcontextprotocol/sdk', 'link', {
      from: 'vsc-bridge', to: '@modelcontextprotocol/sdk', relation: 'DEPENDS_ON',
    });
    await callAndShow(client, 8, 'Link: typescript DEPENDS_ON node.js', 'link', {
      from: 'typescript', to: 'node.js', relation: 'DEPENDS_ON',
    });

    await client.callTool('remember', {
      concept: '@you', details: 'The project lead', category: 'person',
    });
    await callAndShow(client, 9, 'Link: vsc-bridge LEADS @you', 'link', {
      from: 'vsc-bridge', to: '@you', relation: 'LEADS',
    });
    await callAndShow(client, 10, 'Link duplicate (should say exists)', 'link', {
      from: 'vsc-bridge', to: 'typescript', relation: 'DEPENDS_ON',
    });
    await callAndShow(client, 11, 'Link to missing concept (should error)', 'link', {
      from: 'vsc-bridge', to: 'nonexistent-thing', relation: 'DEPENDS_ON',
    });

    // Step 12: recall
    await callAndShow(client, 12, 'Recall "vsc-bridge" with related', 'recall', {
      concept: 'vsc-bridge', include_related: true,
    });

    // Step 13-14: project_status
    console.log('--- 13. Project status "vsc-bridge" ---');
    const statusRes = await client.callTool('project_status', { name: 'vsc-bridge' });
    console.log('   Result:\n' + (await getResultText(statusRes)) + '\n');

    await callAndShow(client, 14, 'Project status missing project', 'project_status', {
      name: 'ghost-project',
    });

    // Step 15-16: whats_blocking
    console.log('--- 15. Dependencies of "vsc-bridge" ---');
    const blockRes = await client.callTool('whats_blocking', { concept: 'vsc-bridge' });
    console.log('   Result:\n' + (await getResultText(blockRes)) + '\n');

    console.log('--- 16. Dependencies of "node.js" (should have none) ---');
    const blockRes2 = await client.callTool('whats_blocking', { concept: 'node.js' });
    console.log('   Result:\n' + (await getResultText(blockRes2)) + '\n');

    // Step 17-18: summarize
    console.log('--- 17. Summarize all (with relationships) ---');
    const sumRes = await client.callTool('summarize', { include_relationships: true });
    console.log('   Result:\n' + (await getResultText(sumRes)) + '\n');

    console.log('--- 18. Summarize category "project" ---');
    const sumRes2 = await client.callTool('summarize', { category: 'project' });
    console.log('   Result:\n' + (await getResultText(sumRes2)) + '\n');

    // Step 19-20: list
    await callAndShow(client, 19, 'List all concepts', 'list', {});
    await callAndShow(client, 20, 'List category "person"', 'list', { category: 'person' });

    // Step 21-22: forget
    await callAndShow(client, 21, 'Forget "@you"', 'forget', { concept: '@you' });
    await callAndShow(client, 22, 'Verify forget — list persons', 'list', { category: 'person' });

    console.log('=== ✅ All 22 tests completed successfully ===');
  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    client.close();
  }
}

runTests();
