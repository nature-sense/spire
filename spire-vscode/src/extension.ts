import * as vscode from 'vscode';
import { SpireSidebarProvider } from './ui/sidebar-provider';
import { initMemoryBank } from './context/memoryBank';
import { IOrchestrator } from './core/interfaces/orchestrator';
import { Orchestrator } from './orchestration/orchestrator';
import { ProviderFactory } from './llm/provider-factory';
import { ILLMProvider } from './core/interfaces/llm-provider';
import { loadConfig, SpireConfig } from './config/config';
import {
  loadMcpConfig,
  validateMcpConfig,
  reloadMcpConfig,
} from './mcp/mcp-config';
import { McpClient } from './mcp/mcp-client';
import { McpToolAdapter } from './mcp/mcp-tool-adapter';
import { registerMetaTools } from './tools/meta-tools';
import { registerVSCodeTools } from './tools/vscode-tools';

import { DirectWorkflow } from './orchestration/workflows/direct';
import { ReActWorkflow } from './orchestration/workflows/react';
import { IWorkflow } from './core/interfaces/workflow';
import { McpServerConfig } from './core/interfaces/mcp-client';
import { Tool } from './core/models/tool';

// ── Refactor imports ──────────────────────────────────────────
import { McpManager } from './mcp/mcp-manager';
import { McpObservability } from './monitoring/mcp-observability';
import { McpStatusBar } from './ui/mcp-status-bar';
import { McpDashboardProvider } from './ui/mcp-dashboard';

// ── Graph Prompt Augmentation imports ────────────────────────────
import { GraphPromptAugmenter } from './augmenter/GraphPromptAugmenter';
import { HardCodedToolProvider } from './providers/HardCodedToolProvider';

let provider: SpireSidebarProvider;
let orchestrator: Orchestrator;
let llmProvider: ILLMProvider;
let mcpClient: McpClient;
let mcpToolAdapter: McpToolAdapter;

// ── Refactor globals ──────────────────────────────────────────
let mcpManager: McpManager;
let mcpObservability: McpObservability;
let mcpStatusBar: McpStatusBar;
let mcpDashboardProvider: McpDashboardProvider;

// ── Graph Prompt Augmentation ────────────────────────────────
let graphAugmenter: GraphPromptAugmenter;

export async function activate(context: vscode.ExtensionContext) {
  console.log('⛰️ Spire is now active!');

  // Initialize the LLM provider via ProviderFactory
  const config = loadConfig();
  llmProvider = ProviderFactory.create({
    type: 'deepseek',
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    enableThinking: config.enableThinking,
    reasoningEffort: config.reasoningEffort
  });

  // Initialize orchestrator
  orchestrator = new Orchestrator(llmProvider);

  // Register built-in workflows
  const workflows: Map<string, IWorkflow> = new Map();
  const agentic = orchestrator.getWorkflow();
  workflows.set(agentic.name, agentic);

  const directWf = new DirectWorkflow();
  const reactWf = new ReActWorkflow();
  workflows.set(directWf.name, directWf);
  workflows.set(reactWf.name, reactWf);

  // ── Initialize MCP infrastructure (refactored) ────────────────────
  mcpObservability = new McpObservability({
    enabled: true,
    logLevel: 'info',
    maxMetricsHistory: 1000,
  });

  mcpClient = new McpClient();
  mcpManager = new McpManager(
    mcpClient,
    orchestrator.getToolRegistry(),
    mcpObservability,
    {
      healthCheckIntervalMs: 30000,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 1000,
      autoStart: true,
    }
  );

  // Register the MCP Dashboard webview provider
  mcpDashboardProvider = new McpDashboardProvider(mcpManager, mcpObservability);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      McpDashboardProvider.viewType,
      mcpDashboardProvider
    )
  );

  // Status bar
  mcpStatusBar = new McpStatusBar(mcpObservability, () => {
    mcpDashboardProvider.reveal();
  });

  // Wire status events → status bar
  mcpClient.onStatusChange((event) => {
    mcpStatusBar.updateFromStatusEvent(event);
  });
  // Wire metrics → status bar
  mcpObservability.onMetricsUpdated((metrics) => {
    mcpStatusBar.updateMetrics(metrics);
  });

  // Start MCP connections from ~/.spire/mcp.json
  await initializeMcpManager();

  // Register Spire meta-tools (self-awareness tools)
  registerSpireMetaTools(config, workflows);

  // Register VS Code API tools (editor interaction, notifications, etc.)
  registerVSCodeTools({
    registerTool: (tool) => orchestrator.registerTool(tool),
    extensionContext: context,
  });
  console.log('✅ Spire: VS Code API tools registered');

  // ── Initialize Graph Prompt Augmenter (Day 0 provider) ──────────
  graphAugmenter = new GraphPromptAugmenter(
    mcpClient,
    new HardCodedToolProvider()
  );
  const augmenterInfo = graphAugmenter.getProviderInfo();
  console.log(
    `✅ Spire: Graph Prompt Augmenter initialized — ` +
    `provider=${augmenterInfo.name}, ` +
    `tools=${augmenterInfo.supportedTools.length}`
  );

  // Wire the augmenter into the sidebar provider
  provider = new SpireSidebarProvider(context, orchestrator, graphAugmenter);

  // Register as a webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'spireSidebar',
      provider
    )
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('spire.openChat', () => {
      provider.reveal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spire.clearHistory', () => {
      provider.reveal();
      provider.postMessage({ type: 'clear' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spire.initMemoryBank', async () => {
      const config = loadConfig();
      await initMemoryBank(config.workspaceRoot || undefined);
      vscode.window.showInformationMessage('✅ Memory Bank initialized!');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spire.loadContext', () => {
      provider.reveal();
      provider.postMessage({ type: 'loadContext' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spire.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your DeepSeek API key',
        password: true,
        placeHolder: 'sk-...'
      });
      
      if (key) {
        await vscode.workspace.getConfiguration('spire').update('apiKey', key, true);
        vscode.window.showInformationMessage('✅ API key saved successfully!');
        provider.reveal();
      }
    })
  );

  // ── MCP Dashboard commands ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('spire.showMCPDashboard', () => {
      mcpDashboardProvider.reveal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spire.mcpRestartServer', async (serverId?: string) => {
      if (!serverId) {
        serverId = await vscode.window.showInputBox({
          prompt: 'Enter MCP server ID to restart',
          placeHolder: 'e.g. filesystem',
        });
      }
      if (serverId) {
        try {
          await mcpManager.restartServer(serverId);
          vscode.window.showInformationMessage(`✅ Restarted MCP server "${serverId}"`);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to restart "${serverId}": ${(err as Error).message}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spire.mcpReloadConfig', async () => {
      try {
        const servers = reloadMcpConfig(getCurrentWorkspaceRoot());
        await mcpManager.reloadConfig(async () => servers);
        vscode.window.showInformationMessage('✅ MCP configuration reloaded from ~/.spire/mcp.json');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to reload MCP config: ${(err as Error).message}`);
      }
    })
  );

  // Re-initialize engine when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('spire')) {
        const newConfig = loadConfig();
        llmProvider = ProviderFactory.create({
          type: 'deepseek',
          apiKey: newConfig.apiKey,
          model: newConfig.model,
          temperature: newConfig.temperature,
          maxTokens: newConfig.maxTokens,
          enableThinking: newConfig.enableThinking,
          reasoningEffort: newConfig.reasoningEffort
        });
        orchestrator = new Orchestrator(llmProvider);
        // Re-initialize MCP with new orchestrator
        try {
          const servers = reloadMcpConfig(getCurrentWorkspaceRoot());
          await mcpManager.reloadConfig(async () => servers);
          // Re-register meta-tools with new orchestrator
          registerSpireMetaTools(newConfig, workflows);
        } catch (err) {
          console.error('Spire: failed to re-initialize MCP:', err);
        }
      }
    })
  );

  console.log('✅ Spire: Extension activated');
}

/** Resolve the currently-open workspace root (or empty string if none). */
function getCurrentWorkspaceRoot(): string {
  return vscode.workspace.rootPath || vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
}

/**
 * Initialize MCP Manager — connects configured servers and starts health checks.
 */
async function initializeMcpManager(): Promise<void> {
  try {
    const mcpConfig = loadMcpConfig(getCurrentWorkspaceRoot());
    const validationErrors = validateMcpConfig(mcpConfig);

    if (validationErrors.length > 0) {
      console.warn('Spire: MCP config warnings:', validationErrors.join(', '));
    }

    await mcpManager.start(mcpConfig.servers);
    console.log(`✅ Spire: MCP Manager started with ${mcpConfig.servers.length} server(s)`);
  } catch (err) {
    console.warn('Spire: MCP initialization skipped:', (err as Error).message);
  }
}

/**
 * Register Spire meta-tools (self-awareness tools) into the orchestrator's tool registry.
 */
function registerSpireMetaTools(
  config: SpireConfig,
  workflows: Map<string, IWorkflow>
): void {
  const currentWorkflow = orchestrator.getWorkflow().name;

  // Build a workflow info map matching MetaToolDependencies
  const workflowInfos = new Map<string, { name: string; description: string }>();
  for (const [name, wf] of workflows) {
    workflowInfos.set(name, { name, description: wf.description || '' });
  }

  registerMetaTools({
    mcpClient,
    mcpManager,
    spireConfig: config,
    workspaceRoot: vscode.workspace.rootPath || vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '',
    workflows: workflowInfos,
    currentWorkflow,
    registerTool: (tool: Tool) => orchestrator.registerTool(tool),
    refreshConfig: () => loadConfig(),
  });

  console.log('✅ Spire: Meta-tools registered');
}

export function deactivate() {
  if (mcpStatusBar) {
    mcpStatusBar.dispose();
  }
  if (mcpManager) {
    mcpManager.stop();
  }
  console.log('⛰️ Spire is now deactivated');
}
