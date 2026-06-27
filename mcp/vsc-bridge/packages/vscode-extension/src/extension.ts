import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleRequest, JsonRpcRequest, JsonRpcResponse } from './handlers/index.js';

const SOCKET_DIR = path.join(os.homedir(), '.spire');
const SOCKET_PATH = path.join(SOCKET_DIR, 'vscode-ipc.sock');

let server: net.Server | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('VSC Bridge');
  outputChannel.appendLine('[vsc-bridge] Activating extension...');

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = '$(circle-slash) VSC Bridge';
  statusBarItem.tooltip = 'VSC Bridge: Stopped';
  statusBarItem.command = 'spire-vsc-bridge.status';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(outputChannel);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('spire-vsc-bridge.start', startServer),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('spire-vsc-bridge.stop', stopServer),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('spire-vsc-bridge.status', showStatus),
  );

  // Auto-start
  startServer();

  outputChannel.appendLine('[vsc-bridge] Extension activated');
  updateStatusBar('stopped');
}

function startServer() {
  if (server) {
    outputChannel.appendLine('[vsc-bridge] Server already running');
    return;
  }

  outputChannel.appendLine(`[vsc-bridge] Starting IPC server at ${SOCKET_PATH}`);

  try {
    // Ensure socket directory exists
    if (!fs.existsSync(SOCKET_DIR)) {
      fs.mkdirSync(SOCKET_DIR, { recursive: true });
    }

    // Remove existing socket file if present
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }

    server = net.createServer((socket) => {
      outputChannel.appendLine('[vsc-bridge] Client connected');

      let buffer = '';

      socket.on('data', (data: Buffer) => {
        buffer += data.toString();

        // Process complete messages (delimited by \n)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          processMessage(socket, line);
        }
      });

      socket.on('error', (err: Error) => {
        outputChannel.appendLine(`[vsc-bridge] Socket error: ${err.message}`);
      });

      socket.on('close', () => {
        outputChannel.appendLine('[vsc-bridge] Client disconnected');
      });
    });

    server.listen(SOCKET_PATH, () => {
      // Set permissions so only the user can read/write
      fs.chmodSync(SOCKET_PATH, 0o600);
      outputChannel.appendLine('[vsc-bridge] IPC server listening');
      updateStatusBar('running');
    });

    server.on('error', (err: Error) => {
      outputChannel.appendLine(`[vsc-bridge] Server error: ${err.message}`);
      updateStatusBar('error');
      server = null;
    });

    server.on('close', () => {
      outputChannel.appendLine('[vsc-bridge] Server closed');
      updateStatusBar('stopped');
      server = null;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[vsc-bridge] Failed to start server: ${message}`);
    vscode.window.showErrorMessage(`VSC Bridge failed to start: ${message}`);
    updateStatusBar('error');
  }
}

function stopServer() {
  if (!server) {
    outputChannel.appendLine('[vsc-bridge] Server not running');
    return;
  }

  outputChannel.appendLine('[vsc-bridge] Stopping server...');

  try {
    server.close();
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[vsc-bridge] Error stopping server: ${message}`);
  }

  server = null;
  updateStatusBar('stopped');
}

function showStatus() {
  if (server?.listening) {
    vscode.window.showInformationMessage(
      `VSC Bridge is running at ${SOCKET_PATH}`,
    );
  } else {
    vscode.window.showInformationMessage('VSC Bridge is stopped');
  }
}

function updateStatusBar(state: 'running' | 'stopped' | 'error') {
  if (!statusBarItem) return;

  switch (state) {
    case 'running':
      statusBarItem.text = '$(plug) VSC Bridge';
      statusBarItem.tooltip = 'VSC Bridge: Running';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'stopped':
      statusBarItem.text = '$(circle-slash) VSC Bridge';
      statusBarItem.tooltip = 'VSC Bridge: Stopped';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = '$(error) VSC Bridge';
      statusBarItem.tooltip = 'VSC Bridge: Error';
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground',
      );
      break;
  }
}

async function processMessage(socket: net.Socket, line: string) {
  let request: JsonRpcRequest;

  try {
    request = JSON.parse(line);
  } catch {
    outputChannel.appendLine(`[vsc-bridge] Invalid JSON received: ${line}`);
    const response: JsonRpcResponse = {
      id: '',
      error: 'Invalid JSON',
    };
    socket.write(JSON.stringify(response) + '\n');
    return;
  }

  if (!request.id || !request.method) {
    outputChannel.appendLine(
      `[vsc-bridge] Invalid request: missing id or method`,
    );
    const response: JsonRpcResponse = {
      id: request.id || '',
      error: 'Missing id or method',
    };
    socket.write(JSON.stringify(response) + '\n');
    return;
  }

  outputChannel.appendLine(
    `[vsc-bridge] Handling request: ${request.method} (id: ${request.id})`,
  );

  const response = await handleRequest(request);
  socket.write(JSON.stringify(response) + '\n');

  outputChannel.appendLine(
    `[vsc-bridge] Response sent for: ${request.method} (id: ${request.id})`,
  );
}

export function deactivate() {
  outputChannel.appendLine('[vsc-bridge] Deactivating extension...');
  stopServer();
  outputChannel.dispose();
}
