import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReActWorkflow } from '../../../src/orchestration/workflows/react';
import { ILLMProvider } from '../../../src/core/interfaces/llm-provider';
import { IToolRegistry } from '../../../src/core/interfaces/tool-registry';
import { WorkspaceContext } from '../../../src/core/models/context';

describe('ReActWorkflow', () => {
  let workflow: ReActWorkflow;
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
    workflow = new ReActWorkflow();
  });

  it('execute() should handle direct response without tool calls', async () => {
    vi.mocked(llmMock.sendMessage).mockResolvedValue({
      content: 'Final Answer: Done!',
    });

    const response = await workflow.execute('Hello', context, llmMock, registryMock, {});
    
    expect(llmMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(response.content).toBe('Final Answer: Done!');
  });

  it('execute() should parse tool calls, execute them, and loop', async () => {
    // First turn: LLM decides to call a tool
    vi.mocked(llmMock.sendMessage).mockResolvedValueOnce({
      content: 'Thinking...',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{"arg": 1}' }
      }]
    });

    vi.mocked(registryMock.execute).mockResolvedValue({
      content: 'Tool success',
      success: true
    });

    // Second turn: LLM sees tool result and answers
    vi.mocked(llmMock.sendMessage).mockResolvedValueOnce({
      content: 'Final Answer: 42',
    });

    const response = await workflow.execute('Hello', context, llmMock, registryMock, {});

    expect(registryMock.execute).toHaveBeenCalledWith('test_tool', { arg: 1 });
    expect(llmMock.sendMessage).toHaveBeenCalledTimes(2);
    expect(response.content).toBe('Final Answer: 42');
  });

  it('execute() should handle max iterations gracefully', async () => {
    vi.mocked(llmMock.sendMessage).mockResolvedValue({
      content: 'Thinking...',
      toolCalls: [{
        id: '1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{"arg": 1}' }
      }]
    });

    vi.mocked(registryMock.execute).mockResolvedValue({
      content: 'Tool success',
      success: true
    });

    // It should stop after MaxIterations (e.g., 5 or 10)
    const response = await workflow.execute('Hello', context, llmMock, registryMock, { maxIterations: 5 });
    
    expect(llmMock.sendMessage).toHaveBeenCalledTimes(5);
    expect(response.content).toContain('Reached maximum iteration limit');
    expect(response.content).toContain('Thinking...');
  });
});
