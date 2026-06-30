import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgenticWorkflow } from '../../../src/orchestration/workflows/agentic-workflow';
import { ILLMProvider } from '../../../src/core/interfaces/llm-provider';
import { IToolRegistry } from '../../../src/core/interfaces/tool-registry';
import { WorkspaceContext } from '../../../src/core/models/context';

describe('AgenticWorkflow', () => {
  let workflow: AgenticWorkflow;
  let llmMock: ILLMProvider;
  let registryMock: IToolRegistry;
  let context: WorkspaceContext;

  beforeEach(() => {
    llmMock = {
      sendMessage: vi.fn(),
      listModels: vi.fn(),
      validateApiKey: vi.fn(),
      getProviderName: vi.fn().mockReturnValue('mock'),
    } as unknown as ILLMProvider;

    registryMock = {
      list: vi.fn().mockReturnValue([{ name: 'test_tool', description: 'Test', parameters: {} }]),
      get: vi.fn(),
      execute: vi.fn(),
    } as unknown as IToolRegistry;

    context = {};
    workflow = new AgenticWorkflow();
  });

  it('execute() should handle direct response without tool calls', async () => {
    vi.mocked(llmMock.sendMessage).mockResolvedValue({
      content: 'Hello, world!',
    });

    const response = await workflow.execute('Hello', context, llmMock, registryMock, {});
    
    expect(llmMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(response.content).toBe('Hello, world!');
  });

  it('execute() should execute tool calls, and loop', async () => {
    vi.mocked(llmMock.sendMessage).mockResolvedValueOnce({
      content: 'I will call a tool.',
      toolCalls: [{ id: '1', type: 'function', function: { name: 'test_tool', arguments: '{"arg": 1}' } }]
    });

    vi.mocked(registryMock.execute).mockResolvedValue({
      content: 'Tool success',
      success: true
    });

    vi.mocked(llmMock.sendMessage).mockResolvedValueOnce({
      content: 'Final Answer: 42',
    });

    const response = await workflow.execute('Hello', context, llmMock, registryMock, {});

    expect(registryMock.execute).toHaveBeenCalledWith('test_tool', { arg: 1 });
    expect(llmMock.sendMessage).toHaveBeenCalledTimes(2);
    expect(response.content).toBe('Final Answer: 42');
  });
});
