import * as vscode from 'vscode';

interface EditorContext {
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

export async function handleGetContext(_params: Record<string, unknown>): Promise<EditorContext> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return {
      activeFile: null,
      cursorLine: null,
      cursorColumn: null,
      selectionStartLine: null,
      selectionStartColumn: null,
      selectionEndLine: null,
      selectionEndColumn: null,
      selectionText: null,
      workspaceRoot: null,
      openFiles: [],
      languageId: null,
    };
  }

  const document = editor.document;
  const selection = editor.selection;
  const cursorPos = selection.active;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

  const openFiles = vscode.workspace.textDocuments.map((doc) => doc.uri.fsPath);

  return {
    activeFile: document.uri.fsPath || null,
    cursorLine: cursorPos.line + 1,
    cursorColumn: cursorPos.character + 1,
    selectionStartLine: selection.start.line + 1,
    selectionStartColumn: selection.start.character + 1,
    selectionEndLine: selection.end.line + 1,
    selectionEndColumn: selection.end.character + 1,
    selectionText: document.getText(selection) || null,
    workspaceRoot: workspaceFolder?.uri.fsPath ?? null,
    openFiles,
    languageId: document.languageId,
  };
}
