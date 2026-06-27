import * as vscode from 'vscode';
import { WorkspaceContext } from '../core/models/context';
import { loadMemoryBank, formatMemoryBankForPrompt } from '../context/memoryBank';
import { loadClineRules } from '../context/rules';

export interface BuildContextOptions {
  includeMemoryBank?: boolean;
  includeClineRules?: boolean;
  includeOpenFiles?: boolean;
  maxFileContentLength?: number;
  workspaceRoot?: string;
}

export class ContextBuilder {
  private options: BuildContextOptions;

  constructor(options?: BuildContextOptions) {
    this.options = {
      includeMemoryBank: true,
      includeClineRules: true,
      includeOpenFiles: true,
      maxFileContentLength: 50000,
      ...options
    };
  }

  /**
   * Build a full workspace context for the orchestrator.
   */
  async build(): Promise<WorkspaceContext> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const activeEditor = vscode.window.activeTextEditor;

    const context: WorkspaceContext = {};

    // Project info
    if (workspaceFolders && workspaceFolders.length > 0) {
      context.projectInfo = {
        name: workspaceFolders[0].name,
        root: workspaceFolders[0].uri.fsPath,
        techStack: this.detectTechStack(workspaceFolders[0].uri.fsPath),
        dependencies: {},
        devDependencies: {},
        scripts: {}
      };
    }

    // Current file
    if (activeEditor) {
      const content = activeEditor.document.getText();
      context.currentFile = {
        path: activeEditor.document.uri.fsPath,
        language: activeEditor.document.languageId,
        content: content,
        contentSnippet: content.length > (this.options.maxFileContentLength ?? 50000)
          ? content.slice(0, this.options.maxFileContentLength) + '\n// ... (truncated)'
          : content
      };

      if (!activeEditor.selection.isEmpty) {
        context.currentFile.selection = {
          start: { line: activeEditor.selection.start.line + 1, character: activeEditor.selection.start.character },
          end: { line: activeEditor.selection.end.line + 1, character: activeEditor.selection.end.character },
          text: activeEditor.document.getText(activeEditor.selection)
        };
      }
    }

    // Open files
    if (this.options.includeOpenFiles) {
      context.openFiles = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputText)
        .map(tab => (tab.input as vscode.TabInputText).uri.fsPath);
    }

    // Diagnostics
    const diagnostics = vscode.languages.getDiagnostics();
    context.diagnostics = diagnostics.flatMap(([uri, diags]) =>
      diags.slice(0, 3).map(d => ({
        file: uri.fsPath,
        severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const
          : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' as const
          : 'info' as const,
        message: d.message,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1
      }))
    ).slice(0, 50);

    return context;
  }

  /**
   * Build a system prompt string from workspace context.
   * Optimised for DeepSeek V4 — concise headers, minimal fluff.
   * V4 responds best to clear hierarchical instructions with
   * token-efficient section markers.
   */
  async buildSystemPrompt(context: WorkspaceContext): Promise<string> {
    const sections: string[] = [
      '# Role',
      'You are Spire, an AI coding assistant inside VS Code. You have tool access to read, write, search, and run commands in the user\'s project.',
      '',
      '# Capabilities',
      '- Read and write files',
      '- Search across the codebase',
      '- Analyze diagnostics and errors',
      '- Execute terminal commands',
      '- Access project structure and dependencies',
      '',
      '# Loop',
      'For each user message:',
      '1. Understand the request.',
      '2. Plan your approach — one step at a time.',
      '3. Call one tool at a time.',
      '4. Check each result before the next step.',
      '5. Respond with a clear summary.',
      '',
      '# Rules',
      '- Think step-by-step before each tool call.',
      '- Read only what you need.',
      '- On error: diagnose and retry with a corrected call.',
      '- After repeated failures on the same sub-task: report the blocker.',
      '- Format all code with ```language annotations.',
      '- If you need more info, ask the user one concise question.'
    ];

    if (context.currentFile) {
      sections.push(`\n# Current Context\nCurrent file: ${context.currentFile.path}`);
    }

    if (context.projectInfo) {
      sections.push(`\nProject: ${context.projectInfo.name}`);
      if (context.projectInfo.techStack.length > 0) {
        sections.push(`Tech stack: ${context.projectInfo.techStack.join(', ')}`);
      }
    }

    if (context.diagnostics && context.diagnostics.length > 0) {
      sections.push(`\n# Active Diagnostics (${context.diagnostics.length})`);
      for (const d of context.diagnostics.slice(0, 5)) {
        sections.push(`  [${d.severity.toUpperCase()}] ${d.file}:${d.line} — ${d.message}`);
      }
    }

    // Add Memory Bank context
    if (this.options.includeMemoryBank) {
      try {
        const workspaceRoot = this.options.workspaceRoot;
        const memoryBank = await loadMemoryBank(workspaceRoot);
        const formatted = formatMemoryBankForPrompt(memoryBank);
        if (formatted) {
          sections.push(`\n## Project Context (Memory Bank)\n${formatted}`);
        }
      } catch {
        // Memory bank unavailable, skip
      }
    }

    // Add Cline rules
    if (this.options.includeClineRules) {
      try {
        const workspaceRoot = this.options.workspaceRoot;
        const rules = await loadClineRules(workspaceRoot);
        if (rules.trim()) {
          sections.push(`\n## Coding Rules\n${rules}`);
        }
      } catch {
        // Rules unavailable, skip
      }
    }

    return sections.join('\n');
  }

  /**
   * Naive tech stack detection.
   */
  private detectTechStack(rootPath: string): string[] {
    const stack: string[] = [];
    try {
      const fs = require('fs');
      const files = fs.readdirSync(rootPath);
      
      if (files.includes('package.json')) stack.push('Node.js');
      if (files.includes('tsconfig.json')) stack.push('TypeScript');
      if (files.includes('Cargo.toml')) stack.push('Rust');
      if (files.includes('go.mod')) stack.push('Go');
      if (files.includes('Pipfile') || files.includes('requirements.txt')) stack.push('Python');
      if (files.includes('Gemfile')) stack.push('Ruby');
      if (files.includes('Dockerfile')) stack.push('Docker');
      if (files.includes('Makefile') || files.includes('makefile')) stack.push('Make');
    } catch {
      // Can't read directory
    }
    return stack;
  }
}
