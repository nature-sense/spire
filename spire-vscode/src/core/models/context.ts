export interface WorkspaceContext {
  currentFile?: FileContext;
  projectInfo?: ProjectInfo;
  openFiles?: string[];
  diagnostics?: Diagnostic[];
}

export interface FileContext {
  path: string;
  language: string;
  content: string;
  contentSnippet?: string;
  selection?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
    text: string;
  };
}

export interface ProjectInfo {
  name: string;
  root: string;
  techStack: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export interface Diagnostic {
  file: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line: number;
  column: number;
}
