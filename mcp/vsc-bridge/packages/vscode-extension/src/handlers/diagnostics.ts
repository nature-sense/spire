import * as vscode from 'vscode';

interface GetDiagnosticsParams {
  path?: string;
}

interface DiagnosticItem {
  message: string;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  severity: 'error' | 'warning' | 'information' | 'hint';
  source: string;
  code: string;
  relatedInformation: { message: string; location: string }[];
}

interface DiagnosticsResult {
  files: {
    [filePath: string]: DiagnosticItem[];
  };
  total: number;
}

export async function handleGetDiagnostics(
  params: Record<string, unknown>,
): Promise<DiagnosticsResult> {
  const { path: filePath } = params as unknown as GetDiagnosticsParams;

  const diagnosticCollection = vscode.languages.getDiagnostics();
  const result: DiagnosticsResult = { files: {}, total: 0 };

  for (const [uri, diagnostics] of diagnosticCollection) {
    const fsPath = uri.fsPath;

    // If a path filter is provided, skip files that don't match
    if (filePath && !fsPath.endsWith(filePath)) {
      continue;
    }

    const items: DiagnosticItem[] = diagnostics.map((d) => ({
      message: d.message,
      range: {
        startLine: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLine: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
      },
      severity: severityToString(d.severity),
      source: d.source || '',
      code: typeof d.code === 'object' && d.code !== null ? String(d.code.value) : String(d.code ?? ''),
      relatedInformation: (d.relatedInformation || []).map((info) => ({
        message: info.message,
        location: info.location.uri.fsPath,
      })),
    }));

    if (items.length > 0) {
      result.files[fsPath] = items;
      result.total += items.length;
    }
  }

  return result;
}

function severityToString(
  severity: vscode.DiagnosticSeverity,
): 'error' | 'warning' | 'information' | 'hint' {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'information';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'information';
  }
}
