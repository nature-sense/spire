import * as vscode from 'vscode';
import * as path from 'path';

interface SearchSymbolsParams {
  query: string;
}

interface FindReferencesParams {
  path: string;
  line: number;
  column: number;
}

interface GetCompletionsParams {
  path: string;
  line: number;
  column: number;
}

interface ApplyCodeActionParams {
  path: string;
  diagnostic: {
    message: string;
    range: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    };
  };
}

interface SymbolResult {
  name: string;
  kind: string;
  filePath: string;
  line: number;
  column: number;
  containerName: string;
}

interface ReferenceLocation {
  filePath: string;
  line: number;
  column: number;
}

interface CompletionItem {
  label: string;
  kind: string;
  detail: string;
  documentation: string;
  insertText: string;
}

export async function handleSearchSymbols(
  params: Record<string, unknown>,
): Promise<SymbolResult[]> {
  const { query } = params as unknown as SearchSymbolsParams;

  if (!query) {
    throw new Error('Missing required parameter: query');
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const results: SymbolResult[] = [];

  for (const folder of workspaceFolders) {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query,
    );

    if (symbols) {
      for (const symbol of symbols) {
        const location = symbol.location;
        results.push({
          name: symbol.name,
          kind: symbolKindToString(symbol.kind),
          filePath: location.uri.fsPath,
          line: location.range.start.line + 1,
          column: location.range.start.character + 1,
          containerName: symbol.containerName || '',
        });
      }
    }
  }

  return results;
}

export async function handleFindReferences(
  params: Record<string, unknown>,
): Promise<ReferenceLocation[]> {
  const { path: filePath, line, column } = params as unknown as FindReferencesParams;

  if (!filePath || line === undefined || column === undefined) {
    throw new Error('Missing required parameters: path, line, column');
  }

  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const position = new vscode.Position(line - 1, column - 1);

  const references = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    uri,
    position,
  );

  if (!references) {
    return [];
  }

  return references.map((ref) => ({
    filePath: ref.uri.fsPath,
    line: ref.range.start.line + 1,
    column: ref.range.start.character + 1,
  }));
}

export async function handleGetCompletions(
  params: Record<string, unknown>,
): Promise<CompletionItem[]> {
  const { path: filePath, line, column } = params as unknown as GetCompletionsParams;

  if (!filePath || line === undefined || column === undefined) {
    throw new Error('Missing required parameters: path, line, column');
  }

  const uri = vscode.Uri.file(filePath);
  const position = new vscode.Position(line - 1, column - 1);

  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    position,
  );

  if (!completions) {
    return [];
  }

  const items = 'items' in completions ? completions.items : completions;

  return items.slice(0, 50).map((item) => ({
    label: typeof item.label === 'string' ? item.label : item.label.label,
    kind: item.kind !== undefined
      ? completionItemKindToString(item.kind)
      : 'unknown',
    detail: item.detail || '',
    documentation:
      typeof item.documentation === 'string' ? item.documentation : '',
    insertText:
      typeof item.insertText === 'string'
        ? item.insertText
        : item.insertText
          ? typeof item.insertText === 'object' && 'value' in item.insertText
            ? (item.insertText as { value: string }).value
            : typeof item.label === 'string'
              ? item.label
              : item.label.label
          : typeof item.label === 'string'
            ? item.label
            : item.label.label,
  }));
}

export async function handleApplyCodeAction(
  params: Record<string, unknown>,
): Promise<{ success: true }> {
  const { path: filePath, diagnostic } =
    params as unknown as ApplyCodeActionParams;

  if (!filePath || !diagnostic) {
    throw new Error('Missing required parameters: path, diagnostic');
  }

  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);

  // Create a diagnostic from the provided info
  const codeActionDiagnostic = new vscode.Diagnostic(
    new vscode.Range(
      diagnostic.range.startLine - 1,
      diagnostic.range.startColumn - 1,
      diagnostic.range.endLine - 1,
      diagnostic.range.endColumn - 1,
    ),
    diagnostic.message,
    vscode.DiagnosticSeverity.Error,
  );

  // Get code actions
  const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    'vscode.executeCodeActionProvider',
    uri,
    codeActionDiagnostic.range,
  );

  if (!codeActions || codeActions.length === 0) {
    throw new Error('No code actions available for this diagnostic');
  }

  // Apply the first code action
  const action = codeActions[0];
  if (action.edit) {
    const applied = await vscode.workspace.applyEdit(action.edit);
    if (!applied) {
      throw new Error('Failed to apply code action');
    }
  }

  if (action.command) {
    await vscode.commands.executeCommand(
      action.command.command,
      ...(action.command.arguments || []),
    );
  }

  return { success: true };
}

function symbolKindToString(kind: vscode.SymbolKind): string {
  const names: Record<number, string> = {
    [vscode.SymbolKind.File]: 'file',
    [vscode.SymbolKind.Module]: 'module',
    [vscode.SymbolKind.Namespace]: 'namespace',
    [vscode.SymbolKind.Package]: 'package',
    [vscode.SymbolKind.Class]: 'class',
    [vscode.SymbolKind.Method]: 'method',
    [vscode.SymbolKind.Property]: 'property',
    [vscode.SymbolKind.Field]: 'field',
    [vscode.SymbolKind.Constructor]: 'constructor',
    [vscode.SymbolKind.Enum]: 'enum',
    [vscode.SymbolKind.Interface]: 'interface',
    [vscode.SymbolKind.Function]: 'function',
    [vscode.SymbolKind.Variable]: 'variable',
    [vscode.SymbolKind.Constant]: 'constant',
    [vscode.SymbolKind.String]: 'string',
    [vscode.SymbolKind.Number]: 'number',
    [vscode.SymbolKind.Boolean]: 'boolean',
    [vscode.SymbolKind.Array]: 'array',
    [vscode.SymbolKind.Object]: 'object',
    [vscode.SymbolKind.Key]: 'key',
    [vscode.SymbolKind.Null]: 'null',
    [vscode.SymbolKind.EnumMember]: 'enumMember',
    [vscode.SymbolKind.Struct]: 'struct',
    [vscode.SymbolKind.Event]: 'event',
    [vscode.SymbolKind.Operator]: 'operator',
    [vscode.SymbolKind.TypeParameter]: 'typeParameter',
  };
  return names[kind] || 'unknown';
}

function completionItemKindToString(kind: vscode.CompletionItemKind): string {
  const names: Record<number, string> = {
    [vscode.CompletionItemKind.Text]: 'text',
    [vscode.CompletionItemKind.Method]: 'method',
    [vscode.CompletionItemKind.Function]: 'function',
    [vscode.CompletionItemKind.Constructor]: 'constructor',
    [vscode.CompletionItemKind.Field]: 'field',
    [vscode.CompletionItemKind.Variable]: 'variable',
    [vscode.CompletionItemKind.Class]: 'class',
    [vscode.CompletionItemKind.Interface]: 'interface',
    [vscode.CompletionItemKind.Module]: 'module',
    [vscode.CompletionItemKind.Property]: 'property',
    [vscode.CompletionItemKind.Unit]: 'unit',
    [vscode.CompletionItemKind.Value]: 'value',
    [vscode.CompletionItemKind.Enum]: 'enum',
    [vscode.CompletionItemKind.Keyword]: 'keyword',
    [vscode.CompletionItemKind.Snippet]: 'snippet',
    [vscode.CompletionItemKind.Color]: 'color',
    [vscode.CompletionItemKind.File]: 'file',
    [vscode.CompletionItemKind.Reference]: 'reference',
    [vscode.CompletionItemKind.Folder]: 'folder',
    [vscode.CompletionItemKind.EnumMember]: 'enumMember',
    [vscode.CompletionItemKind.Constant]: 'constant',
    [vscode.CompletionItemKind.Struct]: 'struct',
    [vscode.CompletionItemKind.Event]: 'event',
    [vscode.CompletionItemKind.Operator]: 'operator',
    [vscode.CompletionItemKind.TypeParameter]: 'typeParameter',
  };
  return names[kind] || 'unknown';
}
