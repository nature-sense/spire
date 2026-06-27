import { handleGetContext } from './context.js';
import { handleOpenFile } from './file.js';
import { handleGetDiagnostics } from './diagnostics.js';
import { handleShowNotification, handleShowInputBox } from './notifications.js';
import { handleRunCommand } from './commands.js';
import {
  handleSearchSymbols,
  handleFindReferences,
  handleGetCompletions,
  handleApplyCodeAction,
} from './symbols.js';

export interface JsonRpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  id: string;
  result?: unknown;
  error?: string;
}

type Handler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  getContext: handleGetContext,
  openFile: handleOpenFile,
  getDiagnostics: handleGetDiagnostics,
  showNotification: handleShowNotification,
  showInputBox: handleShowInputBox,
  runCommand: handleRunCommand,
  searchSymbols: handleSearchSymbols,
  findReferences: handleFindReferences,
  getCompletions: handleGetCompletions,
  applyCodeAction: handleApplyCodeAction,
};

export async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  const handler = handlers[method];
  if (!handler) {
    return { id, error: `Unknown method: ${method}` };
  }

  try {
    const result = await handler(params ?? {});
    return { id, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vsc-bridge] Error in method "${method}":`, message);
    return { id, error: message };
  }
}
