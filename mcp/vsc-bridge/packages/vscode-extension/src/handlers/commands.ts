import * as vscode from 'vscode';

interface RunCommandParams {
  command: string;
  args?: unknown[];
}

export async function handleRunCommand(
  params: Record<string, unknown>,
): Promise<{ result: unknown }> {
  const { command, args } = params as unknown as RunCommandParams;

  if (!command) {
    throw new Error('Missing required parameter: command');
  }

  const result = await vscode.commands.executeCommand(command, ...(args || []));
  return { result };
}
