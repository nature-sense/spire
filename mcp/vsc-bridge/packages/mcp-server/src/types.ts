// JSON-RPC protocol types
export interface JsonRpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  id: string;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  id: string;
  error: string;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// Tool parameter types
export interface EditorContext {
  activeFile: string | null;
  cursorLine: number | null;
  cursorColumn: number | null;
  selectionStartLine: number | null;
  selectionStartColumn: number | null;
  selectionEndLine: number | null;
  selectionEndColumn: number | null;
  selectionText: string | null;
  workspaceRoot: string | null;
  openFiles: string[];
  languageId: string | null;
}

export interface OpenFileParams {
  path: string;
  line?: number;
  column?: number;
}

export interface GetDiagnosticsParams {
  path?: string;
}

export interface ShowNotificationParams {
  message: string;
  type?: 'info' | 'warning' | 'error';
}

export interface ShowInputBoxParams {
  prompt: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
}

export interface RunCommandParams {
  command: string;
  args?: unknown[];
}

export interface SearchSymbolsParams {
  query: string;
}

export interface DiagnosticItem {
  message: string;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  severity: 'error' | 'warning' | 'information' | 'hint';
  source: string;
  code: string | number | undefined;
  relatedInformation: { message: string; location: string }[];
}

export interface DiagnosticsResult {
  files: {
    [filePath: string]: DiagnosticItem[];
  };
  total: number;
}

export interface SymbolResult {
  name: string;
  kind: string;
  filePath: string;
  line: number;
  column: number;
  containerName: string;
}
