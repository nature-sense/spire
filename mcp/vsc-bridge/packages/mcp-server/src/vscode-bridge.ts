import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse } from './types.js';

const DEFAULT_SOCKET_PATH = path.join(os.homedir(), '.spire', 'vscode-ipc.sock');
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class VSCodeBridge {
  private socketPath: string;
  private timeoutMs: number;
  private requestId = 0;
  private socket: net.Socket | null = null;

  constructor(socketPath?: string, timeoutMs?: number) {
    this.socketPath = socketPath || DEFAULT_SOCKET_PATH;
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Connect to the VS Code extension's IPC socket.
   * Retries up to MAX_RETRIES times with delay.
   */
  async connect(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.tryConnect();
        console.error(`[vsc-bridge-mcp] Connected to VS Code at ${this.socketPath}`);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          console.error(
            `[vsc-bridge-mcp] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}. Retrying...`,
          );
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Failed to connect to VS Code at ${this.socketPath} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Check if the socket file exists and is accessible.
   */
  async isExtensionRunning(): Promise<boolean> {
    try {
      await fs.promises.access(this.socketPath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.socket) {
      throw new Error('Not connected to VS Code. Call connect() first.');
    }

    const id = String(++this.requestId);
    const request: JsonRpcRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout: ${method} (id: ${id}) after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const onData = (data: Buffer) => {
        const messages = data.toString().split('\n').filter(Boolean);

        for (const msg of messages) {
          try {
            const response: JsonRpcResponse = JSON.parse(msg);

            if (response.id === id) {
              cleanup();
              if ('error' in response && response.error) {
                reject(new Error((response as JsonRpcErrorResponse).error));
              } else {
                resolve((response as JsonRpcSuccessResponse).result);
              }
            }
          } catch {
            // Ignore parse errors for unrelated messages
          }
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(new Error(`Socket error: ${err.message}`));
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Socket closed'));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (this.socket) {
          this.socket.removeListener('data', onData);
          this.socket.removeListener('error', onError);
          this.socket.removeListener('close', onClose);
        }
      };

      if (this.socket) {
        this.socket.on('data', onData);
        this.socket.on('error', onError);
        this.socket.on('close', onClose);
        this.socket.write(JSON.stringify(request) + '\n');
      }
    });
  }

  /**
   * Disconnect from the socket.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      console.error('[vsc-bridge-mcp] Disconnected from VS Code');
    }
  }

  /**
   * Wait for the extension to be ready (socket file exists).
   */
  async waitForExtension(timeoutMs: number = 15000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.isExtensionRunning()) {
        return;
      }
      await this.delay(500);
    }

    throw new Error(
      `VS Code extension not ready after ${timeoutMs}ms. Make sure the extension is installed and activated.`,
    );
  }

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();

      socket.on('connect', () => {
        this.socket = socket;
        resolve();
      });

      socket.on('error', (err: Error) => {
        socket.destroy();
        reject(err);
      });

      socket.setTimeout(5000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });

      socket.connect(this.socketPath);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default VSCodeBridge;
