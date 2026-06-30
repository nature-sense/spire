import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test' } }],
    getConfiguration: () => ({ get: () => null }),
  },
  window: {
    showInformationMessage: vi.fn(),
    createOutputChannel: () => ({ appendLine: vi.fn(), show: vi.fn() }),
    createStatusBarItem: () => ({ show: vi.fn(), dispose: vi.fn() }),
    activeTextEditor: null,
    tabGroups: { all: [] },
  },
  languages: { getDiagnostics: () => [] },
  ExtensionContext: class {},
  StatusBarAlignment: { Left: 1, Right: 2 },
  TabInputText: class {},
}));

import nock from 'nock';
import { DeepSeekProvider } from '../../src/llm/deepseek/deepseek-provider';
import { Orchestrator } from '../../src/orchestration/orchestrator';
import { GraphPromptAugmenter } from '../../src/augmenter/GraphPromptAugmenter';
import { ContextBuilder } from '../../src/orchestration/context-builder';
import { IMcpClient } from '../../src/core/interfaces/mcp-client';
import { ToolCallProvider } from '../../src/providers/types';

describe('Full E2E debug', () => {
  let orchestrator: Orchestrator;
  let llmProvider: DeepSeekProvider;
  let augmenter: GraphPromptAugmenter;
  let builder: ContextBuilder;

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();

    llmProvider = new DeepSeekProvider({ apiKey: 'test', model: 'deepseek-chat' });
    orchestrator = new Orchestrator(llmProvider);

    const mcpClient = { callTool: vi.fn() } as unknown as IMcpClient;
    const toolProvider = {
      analyzePrompt: vi.fn().mockReturnValue({
        shouldCallTool: true,
        originalPrompt: 'Refactor auth logic',
        toolName: 'graph-memory__semantic_search',
        arguments: { query: 'auth' },
        confidence: 0.9,
        augmented: true
      }),
      name: 'Mock',
      supportedTools: []
    } as unknown as ToolCallProvider;

    augmenter = new GraphPromptAugmenter(mcpClient, toolProvider, { enabled: true });
    builder = new ContextBuilder({ workspaceRoot: '/e2e' });

    orchestrator.registerTool({
      name: 'read_file',
      description: 'Reads a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async () => 'const auth = true;'
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('should mock the full flow', async () => {
    const mcpClientMock = (augmenter as any).mcpClient;
    mcpClientMock.callTool.mockResolvedValue({
      content: JSON.stringify([{ name: 'auth.ts', description: 'Handles authentication' }]),
      success: true
    });

    // Setup nock
    const scope1 = nock('https://api.deepseek.com')
      .post('/v1/chat/completions', () => true)
      .reply(200, {
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path": "auth.ts"}' }
            }]
          }
        }]
      });

    console.log('scope1 pending:', scope1.pending?.());

    const scope2 = nock('https://api.deepseek.com')
      .post('/v1/chat/completions', () => true)
      .reply(200, {
        choices: [{
          message: { role: 'assistant', content: 'Refactored auth logic successfully.' }
        }]
      });

    console.log('scope2 pending:', scope2.pending?.());
    console.log('All active mocks:', nock.activeMocks());

    // Trigger Flow
    const rawPrompt = 'Refactor auth logic';
    const augmentedPrompt = await augmenter.processPrompt(rawPrompt);
    console.log('augmentedPrompt:', augmentedPrompt);
    
    const workspaceContext = await builder.build();
    console.log('workspaceContext:', JSON.stringify(workspaceContext));
    
    orchestrator.setContext(workspaceContext);
    console.log('About to call handleUserRequest...');
    console.log('active mocks before call:', nock.activeMocks());

    const response = await orchestrator.handleUserRequest(augmentedPrompt);
    console.log('response:', JSON.stringify(response));
    
    expect(response.content).toBe('Refactored auth logic successfully.');
  });
});
