import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test' } }],
    getConfiguration: () => ({
      get: () => null,
    }),
  },
  window: {
    showInformationMessage: vi.fn(),
    createOutputChannel: () => ({ appendLine: vi.fn(), show: vi.fn() }),
    createStatusBarItem: () => ({ show: vi.fn(), dispose: vi.fn() }),
  },
  ExtensionContext: class {},
  StatusBarAlignment: { Left: 1, Right: 2 },
}));

import nock from 'nock';
import { DeepSeekProvider } from '../../src/llm/deepseek/deepseek-provider';
import { Orchestrator } from '../../src/orchestration/orchestrator';

describe('DeepSeek + Orchestrator with nock', () => {
  let provider: DeepSeekProvider;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    provider = new DeepSeekProvider({
      apiKey: 'test',
      model: 'deepseek-chat',
    });
    orchestrator = new Orchestrator(provider);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should handle a direct request', async () => {
    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [{ message: { role: 'assistant', content: 'Hello!' } }]
      });

    const result = await orchestrator.handleUserRequest('Hi there');
    expect(result.content).toBe('Hello!');
  });
});
