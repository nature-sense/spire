import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator';
import { GraphPromptAugmenter } from '../../src/augmenter/GraphPromptAugmenter';
import { ContextBuilder } from '../../src/orchestration/context-builder';
import { IMcpClient } from '../../src/core/interfaces/mcp-client';
import { ToolCallProvider } from '../../src/providers/types';
import { ILLMProvider } from '../../src/core/interfaces/llm-provider';
import { Message, LLMResponse } from '../../src/core/models/message';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [{ name: 'e2e-project', uri: { fsPath: '/e2e' } }] },
  window: { activeTextEditor: null, tabGroups: { all: [] } },
  languages: { getDiagnostics: () => [] }
}));

function createMockLLMProvider(): ILLMProvider {
  let callCount = 0;
  return {
    sendMessage: vi.fn(async (_messages: Message[]): Promise<LLMResponse> => {
      callCount++;
      if (callCount === 1) {
        // First call: return a tool call for read_file
        return {
          content: '',
          toolCalls: [{
            id: 'call_abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path": "auth.ts"}' }
          }],
          finishReason: 'tool_calls'
        };
      }
      // Second call: return final answer
      return {
        content: 'Refactored auth logic successfully.',
        finishReason: 'stop'
      };
    }),
    listModels: vi.fn().mockResolvedValue(['deepseek-chat']),
    validateApiKey: vi.fn().mockResolvedValue(true),
    getProviderName: vi.fn().mockReturnValue('Mock')
  } as unknown as ILLMProvider;
}

describe('E2E Prompt Flow', () => {
  let orchestrator: Orchestrator;
  let augmenter: GraphPromptAugmenter;
  let builder: ContextBuilder;

  beforeEach(() => {
    const llmProvider = createMockLLMProvider();
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

  it('completes the entire prompt flow successfully', async () => {
    // 1. Setup Mock MCP memory response
    const mcpClientMock = (augmenter as any).mcpClient;
    mcpClientMock.callTool.mockResolvedValue({
      content: JSON.stringify([{ name: 'auth.ts', description: 'Handles authentication' }]),
      success: true
    });

    // 2. Trigger Flow
    const rawPrompt = 'Refactor auth logic';
    const augmentedPrompt = await augmenter.processPrompt(rawPrompt);
    const workspaceContext = await builder.build();
    orchestrator.setContext(workspaceContext);

    // 3. Execute Workflow
    const response = await orchestrator.handleUserRequest(augmentedPrompt);

    // 4. Assertions
    expect(augmentedPrompt).toContain('Refactor auth logic');
    expect(augmentedPrompt).toContain('Handles authentication');

    expect(mcpClientMock.callTool).toHaveBeenCalledTimes(1);

    // Orchestrator should return the final string
    expect(response.content).toBe('Refactored auth logic successfully.');
  });
});
