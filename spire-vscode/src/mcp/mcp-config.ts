import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { McpServerConfig } from '../core/interfaces/mcp-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpConfig {
  servers: McpServerConfig[];
  globalTimeout?: number;
  maxRetries?: number;
}

/**
 * Raw format stored in .spire/mcp.json on disk.
 */
interface McpConfigFile {
  servers: McpConfigFileEntry[];
  globalTimeout?: number;
  maxRetries?: number;
}

interface McpConfigFileEntry {
  id: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

/** Placeholder string users can put in args/env values to be replaced
 *  with the currently-open VS Code workspace root at load time. */
const WORKSPACE_ROOT_PLACEHOLDER = '${workspaceRoot}';

// ---------------------------------------------------------------------------
// Config file location
// ---------------------------------------------------------------------------

/**
 * Get the workspace root path from VS Code, falling back to home directory.
 */
function getWorkspaceRoot(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri.fsPath;
  }
  return process.env.HOME || '/tmp';
}

/**
 * Recursively resolve ${workspaceRoot} placeholders in server config
 * args and env values, substituting the actual workspace root path.
 * The workspaceRoot argument is optional; if omitted, the current VS Code
 * workspace root is resolved at call time.
 */
function resolvePlaceholders(
  servers: McpConfigFileEntry[],
  workspaceRoot?: string
): void {
  const wsRoot = workspaceRoot ?? getWorkspaceRoot();
  const replace = (s: string): string => s.split(WORKSPACE_ROOT_PLACEHOLDER).join(wsRoot);
  for (const srv of servers) {
    if (srv.args) {
      srv.args = srv.args.map(a => (typeof a === 'string' ? replace(a) : a));
    }
    if (srv.env) {
      for (const [key, val] of Object.entries(srv.env)) {
        if (typeof val === 'string') {
          srv.env[key] = replace(val);
        }
      }
    }
  }
}

/**
 * Path to the Spire MCP config file.
 *   ~/.spire/mcp.json  inside the user's home directory
 */
function getConfigFilePath(): string {
  return path.join(os.homedir(), '.spire', 'mcp.json');
}

// ---------------------------------------------------------------------------
// Config reading (no automatic default generation)
// ---------------------------------------------------------------------------

/**
 * Read the config file from disk.
 *
 * Throws if the file does not exist — the extension's initial set of MCP
 * servers is delivered via the bundled .spire/mcp.json, not auto-generated.
 */
function readConfigFile(): McpConfigFile {
  const configPath = getConfigFilePath();

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `MCP config file not found at ${configPath}. ` +
      'Create one manually based on the Spire extension documentation.'
    );

  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as McpConfigFile;

    if (!parsed.servers || parsed.servers.length === 0) {
      throw new Error(`MCP config at ${configPath} contains no server entries.`);
    }

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `Failed to parse MCP config at ${configPath}: ${(err as Error).message}`
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load MCP configuration from .spire/mcp.json.
 *
 * This function does NOT auto-create the config file — it must exist.
 * The initial config is delivered as part of the Spire extension package
 * and should be copied to ~/.spire/mcp.json.
 *
 * @param workspaceRoot Optional workspace root path. If omitted, resolves
 *                      from the current VS Code workspace at call time.
 */
export function loadMcpConfig(workspaceRoot?: string): McpConfig {
  const configFile = readConfigFile();
  resolvePlaceholders(configFile.servers, workspaceRoot);

  return {
    servers: configFile.servers.map(toMcpServerConfig).filter(s => s.enabled !== false),
    globalTimeout: configFile.globalTimeout ?? 30000,
    maxRetries: configFile.maxRetries ?? 3,
  };
}

/**
 * Reload MCP config from disk and return the parsed servers.
 * This is a fresh read that returns raw entries; callers pass to McpManager.reloadConfig().
 *
 * @param workspaceRoot Optional workspace root path. If omitted, resolves
 *                      from the current VS Code workspace at call time.
 */
export function reloadMcpConfig(workspaceRoot?: string): McpServerConfig[] {
  const configFile = readConfigFile();
  resolvePlaceholders(configFile.servers, workspaceRoot);
  return configFile.servers
    .map(toMcpServerConfig)
    .filter(s => s.enabled !== false);
}

function toMcpServerConfig(entry: McpConfigFileEntry): McpServerConfig {
  return {
    id: entry.id,
    type: entry.type,
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
    enabled: entry.enabled !== false,
  };
}

export function validateMcpConfig(config: McpConfig): string[] {
  const errors: string[] = [];

  if (!config.servers || config.servers.length === 0) {
    errors.push('No MCP servers configured');
    return errors;
  }

  for (const server of config.servers) {
    if (!server.id) {
      errors.push('Server missing required "id" field');
    }
    if (!server.type || !['stdio', 'sse'].includes(server.type)) {
      errors.push(`Server "${server.id}": invalid or missing "type" (must be stdio or sse)`);
    }
    if (server.type === 'stdio' && !server.command) {
      errors.push(`Server "${server.id}": stdio type requires a "command"`);
    }
    if (server.type === 'sse' && !server.url) {
      errors.push(`Server "${server.id}": SSE type requires a "url"`);
    }
  }

  return errors;
}
