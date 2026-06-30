import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator';
import { ILLMProvider } from '../../src/core/interfaces/llm-provider';
import { ToolRegistry } from '../../src/tools/tool-registry';
import { Message } from '../../src/core/models/message';

describe('Orchestrator Integration', () => {
  let llmMock: ILLMProvider;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    llmMock = {
      sendMessage: vi.fn(),
      listModels: vi.fn(),
      validateApiKey: vi.fn(),
      getProviderName: vi.fn().mockReturnValue('mock'),
    } as unknown as ILLMProvider;

    orchestrator = new Orchestrator(llmMock);

    // Register a dummy tool
    orchestrator.registerTool({
      name: 'calculate_sum',
      description: 'Calculates sum of a and b',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
        required: ['a', 'b']
      },
      execute: async (params: any) => {
        const sum = params.a + params.b;
        return JSON.stringify({ sum });
      }
    });
  });

  it('handleUserRequest() should execute a tool call and feed it back to the LLM', async () => {
    // LLM decides to call the tool
    vi.mocked(llmMock.sendMessage).mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: '1', type: 'function', function: { name: 'calculate_sum', arguments: '{"a": 2, "b": 2}' } }]
    });

    // LLM receives the result and provides a final answer
    vi.mocked(llmMock.sendMessage).mockResolvedValueOnce({
      content: 'The sum is 4.',
    });

    // Orchestrator handles the loop automatically
    const result = await orchestrator.handleUserRequest('What is 2+2?');

    expect(result.content).toBe('The sum is 4.');
    expect(llmMock.sendMessage).toHaveBeenCalledTimes(2);

    // Verify the second call contained the tool output
    const secondCallArgs = vi.mocked(llmMock.sendMessage).mock.calls[1][0];
    const toolMsg = secondCallArgs.find((m: Message) => m.role === 'tool');
    
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain('{"sum":4}');
    expect(toolMsg!.toolCallId).toBe('1');
  });
});
