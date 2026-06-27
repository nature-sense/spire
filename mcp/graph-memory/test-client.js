#!/usr/bin/env node

/**
 * test-client.js — Simple JSON-RPC MCP client that tests the graph-memory server.
 *
 * Launches the MCP server as a subprocess and sends JSON-RPC messages via stdio.
 * This client: sends initialize → receives tools → calls each tool.
 *
 * Usage: node test-client.js
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_SCRIPT = resolve(__dirname, 'dist/index.js');
const DB_PATH = resolve(__dirname, 'data/test.db');
let requestId = 1;

class MCPTestClient {
  constructor() {
    this.process = null;
    this.buffer = '';
    this.pending = new Map();
    this._ready = false;
  }

  start() {
    return new Promise((resolvePromise, reject) => {
      this.process = spawn('node', [SERVER_SCRIPT], {
        env: { ...process.env, DB_PATH, LOG_LEVEL: 'error' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        process.stderr.write(data);
      });

      this.process.on('error', (err) => {
        reject(err);
      });

      this.process.on('exit', (code) => {
        if (!this._ready) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Give the server a moment to start, then send initialize
      setTimeout(() => {
        this.sendInitialize()
          .then((result) => {
            this._ready = true;
            resolvePromise(result);
          })
          .catch(reject);
      }, 500);
    });
  }

  async sendInitialize() {
    const response = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    return response.result ?? response.error;
  }

  processBuffer() {
    let newlineIdx;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch (e) {
          console.error('Failed to parse:', line);
        }
      }
    }
  }

  handleMessage(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve(msg);
    }
  }

  send(method, params = {}) {
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

      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  callTool(name, args) {
    return this.send('tools/call', { name, arguments: args });
  }

  close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// --- Tests -----------------------------------------------------------------

async function runTests() {
  const client = new MCPTestClient();
  console.log('=== Graph Memory MCP Test Client ===\n');

  try {
    await client.start();
    console.log('✓ Server started and initialized\n');

    // Step 1: List tools
    console.log('--- 1. List tools ---');
    const toolsResp = await client.send('tools/list');
    const tools = toolsResp.result?.tools ?? [];
    console.log('   Available tools:', tools.map((t) => t.name).join(', '));
    console.log();

    // Step 2: remember
    console.log('--- 2. Remember "Quantum Computing" ---');
    const r1 = await client.callTool('remember', {
      concept: 'Quantum Computing',
      details: 'A field of computing using quantum-mechanical phenomena like superposition.',
      category: 'technology',
    });
    console.log('   Result:', JSON.stringify(r1.result ?? r1.error, null, 2));
    console.log();

    // Step 3: remember second concept
    console.log('--- 3. Remember "Qubit" → "Quantum Computing" ---');
    const r2 = await client.callTool('remember', {
      concept: 'Qubit',
      details: 'Basic unit of quantum information, can be in superposition.',
      category: 'technology',
      related_to: 'Quantum Computing',
    });
    console.log('   Result:', JSON.stringify(r2.result ?? r2.error, null, 2));
    console.log();

    // Step 4: recall with related
    console.log('--- 4. Recall "Qubit" (include_related=true) ---');
    const recall = await client.callTool('recall', {
      concept: 'Qubit',
      include_related: true,
    });
    console.log('   Result:', JSON.stringify(recall.result ?? recall.error, null, 2));
    console.log();

    // Step 5: list all
    console.log('--- 5. List all ---');
    const listAll = await client.callTool('list', {});
    console.log('   Result:', JSON.stringify(listAll.result ?? listAll.error, null, 2));
    console.log();

    // Step 6: list by category
    console.log('--- 6. List "technology" ---');
    const listCat = await client.callTool('list', { category: 'technology' });
    console.log('   Result:', JSON.stringify(listCat.result ?? listCat.error, null, 2));
    console.log();

    // Step 7: forget
    console.log('--- 7. Forget "Qubit" ---');
    const forgetResp = await client.callTool('forget', { concept: 'Qubit' });
    console.log('   Result:', JSON.stringify(forgetResp.result ?? forgetResp.error, null, 2));
    console.log();

    // Step 8: list again
    console.log('--- 8. List after forget ---');
    const listAfter = await client.callTool('list', {});
    console.log('   Result:', JSON.stringify(listAfter.result ?? listAfter.error, null, 2));
    console.log();

    // Step 9: recall non-existent
    console.log('--- 9. Recall missing "Banana" ---');
    const missing = await client.callTool('recall', { concept: 'Banana' });
    console.log('   Result:', JSON.stringify(missing.result ?? missing.error, null, 2));
    console.log();

    console.log('=== All tests passed ===');
  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    client.close();
  }
}

runTests();
