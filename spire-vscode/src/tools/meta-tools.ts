import * as path from 'path';
import * as os from 'os';
import { Tool } from '../core/models/tool';
import { IMcpClient, McpServerConfig } from '../core/interfaces/mcp-client';
import { SpireConfig } from '../config/config';
import { reloadMcpConfig } from '../mcp/mcp-config';

export interface MetaToolDependencies {
  mcpClient: IMcpClient;
  mcpManager: {
    reloadConfig(configProvider: () => Promise<McpServerConfig[]>): Promise<void>;
    listConfiguredServers(): McpServerConfig[];
  };
  spireConfig: SpireConfig;
  workspaceRoot: string;
  workflows: Map<string, { name: string; description: string }>;
  currentWorkflow: string;
  registerTool: (tool: Tool) => void;
  refreshConfig: () => SpireConfig;
}

/**
 * Creates and registers all meta-tools (Spire self-awareness tools)
 * into the provided registration function.
 */
export function registerMetaTools(deps: MetaToolDependencies): void {
  const {
    mcpClient,
    mcpManager,
    spireConfig,
    workspaceRoot,
    workflows,
    currentWorkflow,
    registerTool,
    refreshConfig,
  } = deps;

  // ---------------------------------------------------------------
  // 1. get_mcp_config - View MCP server configuration
  // ---------------------------------------------------------------
  registerTool({
    name: 'get_mcp_config',
    description: 'Get the current MCP server configuration including all configured servers and their status. Sensitive data like API keys and passwords are masked. Spire MCP servers are configured in ~/.spire/mcp.json.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const parsedConfig = reloadMcpConfig();
        const connectedServers = mcpClient.getConfig();
        const status = mcpClient.getStatus();

        // Mask sensitive env values
        const sanitizedConfig = parsedConfig.map(srv => ({
          ...srv,
          env: srv.env ? maskSensitiveEnv(srv.env) : undefined
        }));

        const result = {
          configured: sanitizedConfig,
          connected: connectedServers.map(s => s.id),
          status
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error getting MCP config: ${(error as Error).message}`;
      }
    }
  });

  // ---------------------------------------------------------------
  // 2. get_mcp_tools - List all MCP tools
  // ---------------------------------------------------------------
  registerTool({
    name: 'get_mcp_tools',
    description: 'List all available tools from connected MCP servers with their descriptions and parameters',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const servers = mcpClient.listServers();
        const result: any = {
          totalServers: servers.length,
          totalTools: 0,
          servers: []
        };

        for (const server of servers) {
          const tools = await mcpClient.listToolsForServer(server.id);
          result.servers.push({
            id: server.id,
            connected: server.connected,
            tools: tools.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              required: t.parameters?.required || []
            }))
          });
          result.totalTools += tools.length;
        }

        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error listing MCP tools: ${(error as Error).message}`;
      }
    }
  });

  // ---------------------------------------------------------------
  // 3. get_mcp_status - Health and status of MCP servers
  // ---------------------------------------------------------------
  registerTool({
    name: 'get_mcp_status',
    description: 'Get the health and status of all MCP servers',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const status = mcpClient.getStatus();
        const result = {
          timestamp: new Date().toISOString(),
          servers: status.map(s => ({
            id: s.id,
            connected: s.connected,
            uptime: s.uptime,
            lastError: s.lastError,
            tools: s.toolCount,
            latency: s.latency
          }))
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error getting MCP status: ${(error as Error).message}`;
      }
    }
  });

  // ---------------------------------------------------------------
  // 4. get_spire_config - View Spire's configuration
  // ---------------------------------------------------------------
  registerTool({
    name: 'get_spire_config',
    description: "Get Spire's current configuration settings including model, temperature, and workspace info. API keys are masked for security.",
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const config = refreshConfig();
        const mcpConfigPaths = path.join(os.homedir(), '.spire', 'mcp.json');
        const result = {
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          useMemoryBank: config.useMemoryBank,
          useClineRules: config.useClineRules,
          workspaceRoot,
          workflows: Array.from(workflows.keys()),
          currentWorkflow: currentWorkflow,
          mcpConfigFile: mcpConfigPaths,
          // Mask the API key - only show last 4 characters
          hasApiKey: !!config.apiKey,
          apiKeyPreview: config.apiKey
            ? `...${config.apiKey.slice(-4)}`
            : 'not set'
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error getting Spire config: ${(error as Error).message}`;
      }
    }
  });

  // ---------------------------------------------------------------
  // 5. reload_mcp_config - Reload MCP configuration from disk
  // ---------------------------------------------------------------
  registerTool({
    name: 'reload_mcp_config',
    description: 'Reload MCP configuration from ~/.spire/mcp.json and reconnect to all enabled servers. Uses McpManager to ensure tools are re-synced into the registry.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const oldConnected = mcpClient.getConfig();
        const fullConfig = reloadMcpConfig();
        // Use mcpManager.reloadConfig() which handles disconnect + connect + tool re-sync
        await mcpManager.reloadConfig(async () => fullConfig);
        const newConnected = mcpClient.getConfig();

        return [
          'MCP configuration reloaded successfully.',
          `Configured: ${fullConfig.length} server(s)`,
          `Connected: ${newConnected.length} server(s)`,
          `Previously connected: ${oldConnected.length} server(s)`,
          '',
          'Configured servers (from ~/.spire/mcp.json):',
          JSON.stringify(fullConfig.map(s => ({
            id: s.id,
            command: s.command,
            args: s.args,
            enabled: s.enabled !== false
          })), null, 2)
        ].join('\n');
      } catch (error) {
        return `Error reloading MCP config: ${(error as Error).message}`;
      }
    }
  });

  // ---------------------------------------------------------------
  // 6. list_available_workflows - List available workflows
  // ---------------------------------------------------------------
  registerTool({
    name: 'list_available_workflows',
    description: 'List all available workflows and their descriptions',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const workflowList = Array.from(workflows.entries()).map(([name, wf]) => ({
          name,
          description: wf.description || 'No description',
          isActive: name === currentWorkflow
        }));

        const result = {
          currentWorkflow,
          available: workflowList
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `Error listing workflows: ${(error as Error).message}`;
      }
    }
  });
}

/**
 * Masks sensitive environment variables (API keys, passwords, tokens, secrets).
 */
function maskSensitiveEnv(env: Record<string, string>): Record<string, string> {
  const sensitiveKeys = ['api_key', 'api-key', 'apikey', 'password', 'passwd', 'secret', 'token', 'key'];
  const masked: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    const keyLower = key.toLowerCase();
    const isSensitive = sensitiveKeys.some(sk => keyLower.includes(sk));
    masked[key] = isSensitive
      ? value.length > 8
        ? `${value.slice(0, 4)}...${value.slice(-4)}`
        : '****'
      : value;
  }

  return masked;
}
