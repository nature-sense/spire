import * as vscode from 'vscode';
import { Tool } from '../core/models/tool';

/**
 * Dependency container injected by the extension at registration time.
 */
export interface VSCodeToolDependencies {
  registerTool: (tool: Tool) => void;
  extensionContext: vscode.ExtensionContext;
}

/**
 * Registers all VS Code API tools into the tool registry.
 *
 * These tools expose VS Code's editor, window, and language APIs as
 * callable tools — enabling the AI to interact with the editor directly.
 */
export function registerVSCodeTools(deps: VSCodeToolDependencies): void {
  const { registerTool } = deps;

  // ---------------------------------------------------------------
  // 1. open_editor - Open a file at an optional line number
  // ---------------------------------------------------------------
  registerTool({
    name: 'open_editor',
    description: `Open a file in the editor, optionally at a specific line number.

Opens the file in a new editor tab (or reveals it if already open) and jumps
to the specified line. If no line is given, opens at the top of the file.

Parameters:
  path      (string, required)  — Absolute or workspace-relative file path
  line      (number, optional)  — Line number to jump to (1-based)
  column    (number, optional)  — Column number (1-based, default: 1)`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or workspace-relative file path to open',
        },
        line: {
          type: 'number',
          description: 'Line number to navigate to (1-based, optional)',
        },
        column: {
          type: 'number',
          description: 'Column number to navigate to (1-based, default: 1)',
        },
      },
      required: ['path'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { path: string; line?: number; column?: number };
      try {
        // Resolve workspace-relative paths
        let filePath = args.path;
        if (!filePath.startsWith('/')) {
          const wsFolders = vscode.workspace.workspaceFolders;
          if (wsFolders && wsFolders.length > 0) {
            filePath = vscode.Uri.joinPath(wsFolders[0].uri, filePath).fsPath;
          }
        }

        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, {
          preserveFocus: false,
          preview: false,
        });

        // Jump to line if specified
        if (args.line !== undefined) {
          const lineNum = Math.max(0, args.line - 1); // VS Code uses 0-based
          const colNum = args.column ? Math.max(0, args.column - 1) : 0;
          const range = new vscode.Range(lineNum, colNum, lineNum, colNum);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }

        const lineInfo = args.line !== undefined ? ` at line ${args.line}` : '';
        return `✅ Opened "${args.path}"${lineInfo}`;
      } catch (error) {
        return `❌ Failed to open "${args.path}": ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 2. show_notification - Show an info/warning/error toast
  // ---------------------------------------------------------------
  registerTool({
    name: 'show_notification',
    description: `Display a notification toast in VS Code. Use this to inform the user
about important events, progress, or errors.

Parameters:
  message   (string, required)  — The notification text to display
  type      (string, optional)  — Notification severity: "info" (default), "warning", "error"`,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The notification message to display',
        },
        type: {
          type: 'string',
          description: 'Notification type: info (default), warning, or error',
          enum: ['info', 'warning', 'error'],
        },
      },
      required: ['message'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { message: string; type?: string };
      try {
        switch (args.type) {
          case 'warning':
            vscode.window.showWarningMessage(args.message);
            break;
          case 'error':
            vscode.window.showErrorMessage(args.message);
            break;
          default:
            vscode.window.showInformationMessage(args.message);
            break;
        }
        return `✅ Notification shown: "${args.message}" (type: ${args.type || 'info'})`;
      } catch (error) {
        return `❌ Failed to show notification: ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 3. show_input_box - Get text input from the user
  // ---------------------------------------------------------------
  registerTool({
    name: 'show_input_box',
    description: `Show an input box in VS Code to collect text input from the user.
Use this when you need the user to provide a value, confirm an action,
or enter sensitive information (password mode).

Returns the user's input as a string, or null if they cancelled.

Parameters:
  prompt      (string, required)   — The prompt text displayed above the input field
  placeHolder (string, optional)   — Placeholder text inside the input box
  password    (boolean, optional)  — If true, masks the input (for secrets/keys)
  value       (string, optional)   — Default value pre-filled in the input box
  title       (string, optional)   — Title shown in the input box dialog`,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt text to show above the input field',
        },
        placeHolder: {
          type: 'string',
          description: 'Placeholder text inside the input field',
        },
        password: {
          type: 'boolean',
          description: 'If true, mask the input (for API keys, secrets)',
        },
        value: {
          type: 'string',
          description: 'Pre-filled default value',
        },
        title: {
          type: 'string',
          description: 'Title for the input dialog',
        },
      },
      required: ['prompt'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as {
        prompt: string;
        placeHolder?: string;
        password?: boolean;
        value?: string;
        title?: string;
      };
      try {
        const result = await vscode.window.showInputBox({
          prompt: args.prompt,
          placeHolder: args.placeHolder,
          password: args.password,
          value: args.value,
          title: args.title,
          ignoreFocusOut: true,
        });

        if (result === undefined) {
          return JSON.stringify({ cancelled: true, value: null });
        }
        return JSON.stringify({ cancelled: false, value: result });
      } catch (error) {
        return `❌ Failed to show input box: ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 4. show_quick_pick - Show a quick pick list for user selection
  // ---------------------------------------------------------------
  registerTool({
    name: 'show_quick_pick',
    description: `Show a list of options for the user to pick from (Quick Pick).
Use this when you need the user to choose from a set of predefined options.

Returns the selected item(s) as a JSON string.

Parameters:
  items       (array, required)     — Array of items to display. Each item can be:
    - A string (simple display label)
    - An object with { label, description?, detail? }
  canPickMany (boolean, optional)   — Allow multiple selection (default: false)
  placeHolder (string, optional)    — Placeholder text in the search box
  title       (string, optional)    — Title for the quick pick dialog`,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of string items. Each item is a label string. Example: ["Option 1", "Option 2", "Option 3"]',
          items: { type: 'string' },
        },
        canPickMany: {
          type: 'boolean',
          description: 'Allow selecting multiple items (default: false)',
        },
        placeHolder: {
          type: 'string',
          description: 'Placeholder text in the search box',
        },
        title: {
          type: 'string',
          description: 'Title for the quick pick dialog',
        },
      },
      required: ['items'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as {
        items: (string | { label: string; description?: string; detail?: string })[];
        canPickMany?: boolean;
        placeHolder?: string;
        title?: string;
      };
      try {
        // Convert strings to QuickPickItems
        const quickPickItems: vscode.QuickPickItem[] = args.items.map((item) => {
          if (typeof item === 'string') {
            return { label: item };
          }
          return {
            label: item.label,
            description: item.description,
            detail: item.detail,
          };
        });

        if (args.canPickMany) {
          const result = await vscode.window.showQuickPick(quickPickItems, {
            canPickMany: true,
            placeHolder: args.placeHolder,
            title: args.title,
            ignoreFocusOut: true,
          });
          if (!result || result.length === 0) {
            return JSON.stringify({ cancelled: true, selected: [] });
          }
          return JSON.stringify({
            cancelled: false,
            selected: result.map((r) => r.label),
          });
        } else {
          const result = await vscode.window.showQuickPick(quickPickItems, {
            canPickMany: false,
            placeHolder: args.placeHolder,
            title: args.title,
            ignoreFocusOut: true,
          });
          if (!result) {
            return JSON.stringify({ cancelled: true, selected: null });
          }
          return JSON.stringify({ cancelled: false, selected: result.label });
        }
      } catch (error) {
        return `❌ Failed to show quick pick: ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 5. run_vscode_command - Execute any VS Code command
  // ---------------------------------------------------------------
  registerTool({
    name: 'run_vscode_command',
    description: `Execute any registered VS Code command programmatically.

Use this to invoke VS Code's built-in functionality like formatting, refactoring,
source control operations, terminal management, etc.

Parameters:
  command   (string, required)   — The VS Code command ID to execute (e.g. "editor.action.formatDocument")
  args      (array, optional)    — Arguments to pass to the command

Common commands:
  - "editor.action.formatDocument"       — Format the current document
  - "editor.action.organizeImports"       — Organize import statements
  - "editor.action.sourceAction"          — Show code actions
  - "workbench.action.files.save"         — Save the active file
  - "workbench.action.terminal.new"       — Create a new terminal
  - "workbench.view.explorer"             — Focus the file explorer
  - "workbench.view.scm"                  — Focus source control
  - "git.stage"                           — Stage current file
  - "git.commit"                          — Commit staged changes
  - "git.push"                            — Push commits
  - "workbench.action.closeActiveEditor"  — Close active editor`,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The VS Code command ID to execute',
        },
        args: {
          type: 'array',
          description: 'Optional arguments to pass to the command',
          items: {},
        },
      },
      required: ['command'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { command: string; args?: unknown[] };
      try {
        const commandArgs = args.args || [];
        const result = await vscode.commands.executeCommand(
          args.command,
          ...commandArgs,
        );
        const resultStr =
          result !== undefined
            ? ` (result: ${JSON.stringify(result)})`
            : '';
        return `✅ Executed command "${args.command}"${resultStr}`;
      } catch (error) {
        return `❌ Failed to execute command "${args.command}": ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 6. get_diagnostics - Get diagnostics for a file or all files
  // ---------------------------------------------------------------
  registerTool({
    name: 'get_diagnostics',
    description: `Get VS Code diagnostics (errors, warnings, hints) for a file
or for all open files.

Use this to check for problems in the code before suggesting fixes.

Parameters:
  path    (string, optional)  — File path to get diagnostics for.
                               If omitted, returns diagnostics for all visible files.

Returns a JSON array of diagnostics with severity, message, and range.`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or workspace-relative path. Omit for all files.',
        },
      },
      required: [],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { path?: string };
      try {
        const allDiagnostics = vscode.languages.getDiagnostics();
        let results: any[] = [];

        if (args.path) {
          // Resolve path
          let filePath = args.path;
          if (!filePath.startsWith('/')) {
            const wsFolders = vscode.workspace.workspaceFolders;
            if (wsFolders && wsFolders.length > 0) {
              filePath = vscode.Uri.joinPath(wsFolders[0].uri, filePath).fsPath;
            }
          }
          const uri = vscode.Uri.file(filePath);
          const uriStr = uri.toString();

          const entry = allDiagnostics.find(([u]) => u.toString() === uriStr);
          if (!entry) {
            return JSON.stringify({ path: args.path, diagnostics: [] });
          }
          results = [
            {
              path: args.path,
              diagnostics: formatDiagnostics(entry[1]),
            },
          ];
        } else {
          // Collate by file, limit to open editors for relevance
          const openUris = new Set(
            vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()),
          );

          for (const [uri, diags] of allDiagnostics) {
            if (openUris.has(uri.toString()) || allDiagnostics.length <= 5) {
              const wsPath = vscode.workspace.asRelativePath(uri);
              results.push({
                path: wsPath || uri.fsPath,
                diagnostics: formatDiagnostics(diags),
              });
            }
          }
        }

        const totalProblems = results.reduce(
          (sum, r) => sum + r.diagnostics.length,
          0,
        );
        return JSON.stringify(
          { totalProblems, files: results },
          null,
          2,
        );
      } catch (error) {
        return `❌ Failed to get diagnostics: ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 7. apply_code_action - Apply a code action to a file
  // ---------------------------------------------------------------
  registerTool({
    name: 'apply_code_action',
    description: `Find and apply code actions (quick fixes, refactorings) to a file.

Use this to automatically apply VS Code quick fixes such as:
  - Auto-fix linting/type errors
  - Import missing modules
  - Apply suggested refactorings
  - Fix spelling mistakes

Parameters:
  path      (string, required)     — File to get code actions for
  action    (string, optional)     — Filter by action title or kind
                                     (e.g. "Fix all", "Organize imports",
                                      "quickfix", "refactor", "source")
  only      (string, optional)     — If "auto", only applies actions with
                                      \`isPreferred\` set (safe automatic fixes)
  line      (number, optional)     — Only get actions for a specific line (1-based)

Returns a list of applied actions with their titles.
`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to get code actions for',
        },
        action: {
          type: 'string',
          description: 'Filter by action title or kind (e.g. "Fix all", "quickfix", "refactor", "source")',
        },
        only: {
          type: 'string',
          description: 'If "auto", only applies preferred/safe automatic fixes',
          enum: ['auto'],
        },
        line: {
          type: 'number',
          description: 'Only get actions for a specific line (1-based)',
        },
      },
      required: ['path'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { path: string; action?: string; only?: string; line?: number };
      try {
        // Resolve path
        let filePath = args.path;
        if (!filePath.startsWith('/')) {
          const wsFolders = vscode.workspace.workspaceFolders;
          if (wsFolders && wsFolders.length > 0) {
            filePath = vscode.Uri.joinPath(wsFolders[0].uri, filePath).fsPath;
          }
        }
        const uri = vscode.Uri.file(filePath);

        // Open the document to get diagnostics for it
        const document = await vscode.workspace.openTextDocument(uri);

        // Determine range for code actions
        let range: vscode.Range | undefined;
        if (args.line !== undefined) {
          const lineNum = Math.max(0, args.line - 1);
          range = new vscode.Range(lineNum, 0, lineNum, document.lineAt(lineNum).text.length);
        }

        // Get diagnostics for this URI
        const allDiagnostics = vscode.languages.getDiagnostics(uri);

        // Collect diagnostics at the specified range
        const relevantDiags = range
          ? allDiagnostics.filter((d) => d.range.start.line === range.start.line)
          : allDiagnostics;

        // Get code actions
        const context: vscode.CodeActionContext = {
          diagnostics: relevantDiags,
          only: args.action
            ? (args.action.includes('quickfix') ? vscode.CodeActionKind.QuickFix :
               args.action.includes('refactor') ? vscode.CodeActionKind.Refactor :
               args.action.includes('source') ? vscode.CodeActionKind.Source :
               undefined)
            : undefined,
          triggerKind: vscode.CodeActionTriggerKind.Automatic,
        };

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider',
          uri,
          range || new vscode.Range(0, 0, document.lineCount, 0),
          context,
        );

        if (!actions || actions.length === 0) {
          return JSON.stringify({
            file: args.path,
            message: 'No code actions available',
            applied: [],
          });
        }

        // Filter actions
        let filteredActions = actions;
        if (args.action) {
          const lowerAction = args.action.toLowerCase();
          filteredActions = actions.filter(
            (a) =>
              a.title.toLowerCase().includes(lowerAction) ||
              a.kind?.value.toLowerCase().includes(lowerAction),
          );
        }
        if (args.only === 'auto') {
          filteredActions = filteredActions.filter((a) => a.isPreferred);
        }

        if (filteredActions.length === 0) {
          return JSON.stringify({
            file: args.path,
            message: `No matching code actions found (filter: "${args.action || 'none'}")`,
            applied: [],
          });
        }

        // Apply the first matching action
        const actionToApply = filteredActions[0];
        if (actionToApply.edit || actionToApply.command) {
          if (actionToApply.edit) {
            const workEdits = actionToApply.edit;
            const success = await vscode.workspace.applyEdit(workEdits);
            if (!success) {
              return `❌ Failed to apply code action "${actionToApply.title}": workspace edit rejected`;
            }
          }
          if (actionToApply.command) {
            await vscode.commands.executeCommand(
              actionToApply.command.command,
              ...(actionToApply.command.arguments || []),
            );
          }

          return JSON.stringify(
            {
              file: args.path,
              message: `Applied code action`,
              applied: [
                {
                  title: actionToApply.title,
                  kind: actionToApply.kind?.value || 'unknown',
                  isPreferred: actionToApply.isPreferred || false,
                },
              ],
              availableMore: filteredActions.length - 1,
            },
            null,
            2,
          );
        }

        // List available actions if we can't auto-apply
        return JSON.stringify(
          {
            file: args.path,
            message:
              'Actions found but require manual selection. Use show_quick_pick to let the user choose.',
            available: filteredActions.map((a) => ({
              title: a.title,
              kind: a.kind?.value || 'unknown',
              isPreferred: a.isPreferred || false,
            })),
          },
          null,
          2,
        );
      } catch (error) {
        return `❌ Failed to apply code action: ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 8. get_active_editor - Get info about the currently active editor
  // ---------------------------------------------------------------
  registerTool({
    name: 'get_active_editor',
    description: `Get information about the currently active editor tab.

Returns the file path, language, selection, and visible range of the
currently focused editor. Useful for understanding what the user is
looking at right now.

Parameters: none`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (): Promise<string> => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return JSON.stringify({ active: false, message: 'No active editor' });
        }

        const doc = editor.document;
        const selection = editor.selection;
        const visibleRanges = editor.visibleRanges;

        const info = {
          active: true,
          file: doc.uri.fsPath,
          relativePath: vscode.workspace.asRelativePath(doc.uri),
          language: doc.languageId,
          lineCount: doc.lineCount,
          selection: selection.isEmpty
            ? { line: selection.active.line + 1, column: selection.active.character + 1 }
            : {
                start: {
                  line: selection.start.line + 1,
                  column: selection.start.character + 1,
                },
                end: {
                  line: selection.end.line + 1,
                  column: selection.end.character + 1,
                },
                text: doc.getText(selection),
              },
          visibleRange: visibleRanges.length > 0
            ? {
                startLine: visibleRanges[0].start.line + 1,
                endLine: visibleRanges[0].end.line + 1,
              }
            : null,
          isDirty: doc.isDirty,
          isUntitled: doc.isUntitled,
        };

        return JSON.stringify(info, null, 2);
      } catch (error) {
        return `❌ Failed to get active editor info: ${(error as Error).message}`;
      }
    },
  });

  // ---------------------------------------------------------------
  // 9. set_workspace_config - Update VS Code settings
  // ---------------------------------------------------------------
  registerTool({
    name: 'set_workspace_config',
    description: `Set a VS Code configuration value.

Use this to modify VS Code settings programmatically. Can update user
settings (global) or workspace settings (project-specific).

Parameters:
  section      (string, required)   — The configuration section (e.g. "editor.fontSize", "files.autoSave")
  value        (any, required)      — The value to set
  target       (string, optional)   — "global" for User settings, "workspace" for Workspace settings (default: "global")`,
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'The configuration section (e.g. "editor.fontSize", "files.autoSave")',
        },
        value: {
          description: 'The value to set (any JSON-compatible value: string, number, boolean, object, array, null)',
        },
        target: {
          type: 'string',
          enum: ['global', 'workspace'],
          description: '"global" for User settings, "workspace" for Workspace settings',
        },
      },
      required: ['section', 'value'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { section: string; value: any; target?: string };
      try {
        const target =
          args.target === 'workspace'
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;

        const config = vscode.workspace.getConfiguration();
        await config.update(args.section, args.value, target);

        return `✅ Updated "${args.section}" = ${JSON.stringify(args.value)} (${args.target || 'global'})`;
      } catch (error) {
        return `❌ Failed to update config "${args.section}": ${(error as Error).message}`;
      }
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Format VS Code diagnostics into a serializable structure. */
function formatDiagnostics(
  diags: vscode.Diagnostic[],
): Array<{
  severity: string;
  message: string;
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
  source?: string;
  code?: string | number;
}> {
  return diags.map((d) => ({
    severity:
      d.severity === vscode.DiagnosticSeverity.Error
        ? 'error'
        : d.severity === vscode.DiagnosticSeverity.Warning
          ? 'warning'
          : d.severity === vscode.DiagnosticSeverity.Information
            ? 'info'
            : 'hint',
    message: d.message,
    range: {
      startLine: d.range.start.line + 1,
      startCol: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endCol: d.range.end.character + 1,
    },
    source: d.source,
    code: typeof d.code === 'object' && d.code !== null
      ? (d.code as { value: string | number }).value
      : d.code,
  }));
}
