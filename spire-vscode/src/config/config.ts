import * as vscode from 'vscode';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface SpireConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enableThinking: boolean;
  reasoningEffort: ReasoningEffort;
  useMemoryBank: boolean;
  useClineRules: boolean;
  workspaceRoot: string;
}

export function loadConfig(): SpireConfig {
  const config = vscode.workspace.getConfiguration('spire');
  return {
    apiKey: config.get<string>('apiKey', ''),
    model: config.get<string>('model', 'deepseek-chat'),
    temperature: config.get<number>('temperature', 0.7),
    maxTokens: config.get<number>('maxTokens', 8192),
    enableThinking: config.get<boolean>('enableThinking', true),
    reasoningEffort: config.get<ReasoningEffort>('reasoningEffort', 'medium'),
    useMemoryBank: config.get<boolean>('useMemoryBank', true),
    useClineRules: config.get<boolean>('useClineRules', true),
    workspaceRoot: config.get<string>('workspaceRoot', ''),
  };
}

export function onConfigChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('spire')) {
      listener();
    }
  });
}
