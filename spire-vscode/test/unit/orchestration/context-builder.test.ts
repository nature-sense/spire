import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextBuilder } from '../../../src/orchestration/context-builder';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let currentFsPath = '/mock/workspace';

// Mock vscode module
vi.mock('vscode', () => {
  return {
    workspace: {
      get workspaceFolders() {
        return [
          {
            name: 'test-project',
            uri: { fsPath: currentFsPath }
          }
        ];
      }
    },
    window: {
      activeTextEditor: {
        document: {
          uri: { fsPath: '/mock/workspace/index.ts' },
          languageId: 'typescript',
          getText: (selection?: any) => {
            if (selection) return 'selected text';
            return 'const x = 1;\nconsole.log(x);';
          }
        },
        selection: {
          isEmpty: false,
          start: { line: 0, character: 0 },
          end: { line: 0, character: 12 }
        }
      },
      tabGroups: {
        all: [
          {
            tabs: [
              {
                input: {
                  uri: { fsPath: '/mock/workspace/index.ts' }
                }
              }
            ]
          }
        ]
      }
    },
    languages: {
      getDiagnostics: () => []
    },
    TabInputText: class {}
  };
});


// Mock MemoryBank and Rules to avoid file IO
vi.mock('../../../src/context/memoryBank', () => ({
  loadMemoryBank: vi.fn().mockResolvedValue({}),
  formatMemoryBankForPrompt: vi.fn().mockReturnValue('Mocked Memory Bank Context')
}));

vi.mock('../../../src/context/rules', () => ({
  loadClineRules: vi.fn().mockResolvedValue('Mocked Cline Rules')
}));

describe('ContextBuilder', () => {
  let builder: ContextBuilder;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spire-test-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');

    currentFsPath = tempDir;

    builder = new ContextBuilder({
      workspaceRoot: tempDir
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('build() should assemble WorkspaceContext correctly', async () => {
    // Wait, the vscode.TabInputText instance check in builder might fail because
    // of how we mock class {}. Let's see if it builds without crashing.
    const context = await builder.build();

    expect(context.projectInfo).toBeDefined();
    expect(context.projectInfo?.name).toBe('test-project');
    expect(context.projectInfo?.techStack).toContain('Node.js');
    expect(context.projectInfo?.techStack).toContain('TypeScript');

    expect(context.currentFile).toBeDefined();
    expect(context.currentFile?.path).toBe('/mock/workspace/index.ts');
    expect(context.currentFile?.content).toBe('const x = 1;\nconsole.log(x);');
    expect(context.currentFile?.selection?.text).toBe('selected text');
  });

  it('buildSystemPrompt() should include tech stack, memory bank, and rules', async () => {
    const context = await builder.build();
    const prompt = await builder.buildSystemPrompt(context);

    expect(prompt).toContain('You are Spire');
    expect(prompt).toContain('Project: test-project');
    expect(prompt).toContain('Tech stack: Node.js, TypeScript');
    expect(prompt).toContain('Mocked Memory Bank Context');
    expect(prompt).toContain('Mocked Cline Rules');
  });

  it('buildSystemPrompt() should skip missing features gracefully', async () => {
    const emptyBuilder = new ContextBuilder({
      includeMemoryBank: false,
      includeClineRules: false
    });
    const context = await emptyBuilder.build();
    const prompt = await emptyBuilder.buildSystemPrompt(context);

    expect(prompt).not.toContain('Mocked Memory Bank Context');
    expect(prompt).not.toContain('Mocked Cline Rules');
  });
});
