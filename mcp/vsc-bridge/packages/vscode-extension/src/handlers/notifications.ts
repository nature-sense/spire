import * as vscode from 'vscode';

interface ShowNotificationParams {
  message: string;
  type?: 'info' | 'warning' | 'error';
}

interface ShowInputBoxParams {
  prompt: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
  validateInput?: boolean;
}

export async function handleShowNotification(
  params: Record<string, unknown>,
): Promise<{ success: true }> {
  const { message, type } = params as unknown as ShowNotificationParams;

  if (!message) {
    throw new Error('Missing required parameter: message');
  }

  const notificationType = type || 'info';

  switch (notificationType) {
    case 'warning':
      vscode.window.showWarningMessage(message);
      break;
    case 'error':
      vscode.window.showErrorMessage(message);
      break;
    default:
      vscode.window.showInformationMessage(message);
      break;
  }

  return { success: true };
}

export async function handleShowInputBox(
  params: Record<string, unknown>,
): Promise<{ value: string | undefined }> {
  const { prompt, value, placeHolder, password } =
    params as unknown as ShowInputBoxParams;

  if (!prompt) {
    throw new Error('Missing required parameter: prompt');
  }

  const result = await vscode.window.showInputBox({
    prompt,
    value: value || '',
    placeHolder: placeHolder || '',
    password: password || false,
    ignoreFocusOut: true,
  });

  return { value: result };
}
