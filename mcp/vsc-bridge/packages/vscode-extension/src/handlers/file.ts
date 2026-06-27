import * as vscode from 'vscode';
import * as path from 'path';

interface OpenFileParams {
  path: string;
  line?: number;
  column?: number;
}

export async function handleOpenFile(
  params: Record<string, unknown>,
): Promise<{ success: true }> {
  const { path: filePath, line, column } = params as unknown as OpenFileParams;

  if (!filePath) {
    throw new Error('Missing required parameter: path');
  }

  // Resolve relative paths against the workspace root
  let resolvedPath = filePath;
  if (!path.isAbsolute(filePath)) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      resolvedPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
    }
  }

  const uri = vscode.Uri.file(resolvedPath);

  // Check if file exists
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: false,
  });

  // Navigate to specific line/column if provided
  if (line !== undefined && line !== null) {
    const targetLine = Math.max(0, Math.min(line - 1, document.lineCount - 1));
    const lineText = document.lineAt(targetLine);

    let targetColumn = 0;
    if (column !== undefined && column !== null) {
      targetColumn = Math.max(0, Math.min(column - 1, lineText.text.length));
    }

    const position = new vscode.Position(targetLine, targetColumn);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  return { success: true };
}
