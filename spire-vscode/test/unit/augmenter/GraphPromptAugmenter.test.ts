import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphPromptAugmenter } from '../../../src/augmenter/GraphPromptAugmenter';
import { IMcpClient } from '../../../src/core/interfaces/mcp-client';
import { ToolCallProvider, ProviderDecision } from '../../../src/providers/types';

describe('GraphPromptAugmenter', () => {
  let mcpClientMock: IMcpClient;
  let providerMock: ToolCallProvider;
  let augmenter: GraphPromptAugmenter;

  beforeEach(() => {
    mcpClientMock = {
      callTool: vi.fn(),
      getServers: vi.fn(),
      // ... other required methods can be stubbed
    } as unknown as IMcpClient;

    providerMock = {
      name: 'MockProvider',
      supportedTools: ['graph-memory__semantic_search'],
      analyzePrompt: vi.fn(),
    } as unknown as ToolCallProvider;

    augmenter = new GraphPromptAugmenter(mcpClientMock, providerMock, {
      maxContextLength: 1000,
      enabled: true
    });
  });

  it('processPrompt() should return original prompt if provider skips', async () => {
    vi.mocked(providerMock.analyzePrompt).mockReturnValue({
      originalPrompt: 'Hello world',
      confidence: 0,
      augmented: false,
    });

    const result = await augmenter.processPrompt('Hello world');
    expect(result).toBe('Hello world');
    expect(mcpClientMock.callTool).not.toHaveBeenCalled();
  });

  it('processPrompt() should augment prompt if provider decides to call tool', async () => {
    vi.mocked(providerMock.analyzePrompt).mockReturnValue({
      originalPrompt: 'Fix login',
      toolName: 'graph-memory__semantic_search',
      arguments: { query: 'login' },
      confidence: 0.9,
      reasoning: 'Need to look up login concept',
      augmented: true
    });

    vi.mocked(mcpClientMock.callTool).mockResolvedValue({
      content: JSON.stringify([{ name: 'Auth', description: 'Handles login' }]),
      success: true
    });

    const result = await augmenter.processPrompt('Fix login');
    
    expect(mcpClientMock.callTool).toHaveBeenCalled();
    
    expect(result).toContain('Fix login');
    expect(result).toContain('Graph Knowledge Context');
    expect(result).toContain('Handles login');
  });

  it('processPrompt() should return original prompt if tool call fails', async () => {
    vi.mocked(providerMock.analyzePrompt).mockReturnValue({
      originalPrompt: 'Fix login',
      toolName: 'graph-memory__semantic_search',
      arguments: { query: 'login' },
      confidence: 0.9,
      augmented: true
    });

    vi.mocked(mcpClientMock.callTool).mockRejectedValue(new Error('MCP Error'));

    const result = await augmenter.processPrompt('Fix login');
    
    expect(result).toBe('Fix login');
  });

  it('truncateContext() should shorten massive context blocks', async () => {
    const augmenterWithTinyLimit = new GraphPromptAugmenter(mcpClientMock, providerMock, {
      maxContextLength: 10,
      enabled: true
    });

    vi.mocked(providerMock.analyzePrompt).mockReturnValue({
      originalPrompt: 'Prompt',
      toolName: 'graph-memory__semantic_search',
      arguments: { query: 'test' },
      confidence: 0.9,
      augmented: true
    });

    const massiveText = 'A'.repeat(1000);
    vi.mocked(mcpClientMock.callTool).mockResolvedValue({
      content: massiveText,
      success: true
    });

    const result = await augmenterWithTinyLimit.processPrompt('Prompt');
    expect(result.length).toBeLessThan(1000);
    expect(result).toContain('context truncated');
  });

  // ───── storeExchange() ─────

  describe('storeExchange()', () => {
    it('stores an exchange successfully', async () => {
      vi.mocked(mcpClientMock.callTool).mockResolvedValue({
        content: 'Stored',
        success: true,
      });

      const result = await augmenter.storeExchange({
        originalPrompt: 'What is auth?',
        llmResponse: 'Auth handles login.',
      });

      expect(result).toBe(true);
      expect(mcpClientMock.callTool).toHaveBeenCalledWith(
        'graph-memory__remember',
        expect.objectContaining({
          concept: expect.stringContaining('What is auth?'),
          details: expect.stringContaining('Auth handles login.'),
          category: 'conversation',
        })
      );
    });

    it('links exchange to session when sessionId is provided', async () => {
      vi.mocked(mcpClientMock.callTool).mockResolvedValue({
        content: 'Stored',
        success: true,
      });

      await augmenter.storeExchange({
        originalPrompt: 'Fix login bug',
        llmResponse: 'Found the issue.',
        sessionId: 'session-42',
      });

      expect(mcpClientMock.callTool).toHaveBeenCalledWith(
        'graph-memory__remember',
        expect.objectContaining({
          related_to: 'session-42',
        })
      );
    });

    it('returns false when MCP tool call fails', async () => {
      vi.mocked(mcpClientMock.callTool).mockResolvedValue({
        content: '',
        success: false,
        error: 'MCP error',
      });

      const result = await augmenter.storeExchange({
        originalPrompt: 'Test',
        llmResponse: 'Response',
      });

      expect(result).toBe(false);
    });

    it('returns false when MCP tool throws', async () => {
      vi.mocked(mcpClientMock.callTool).mockRejectedValue(new Error('Network error'));

      const result = await augmenter.storeExchange({
        originalPrompt: 'Test',
        llmResponse: 'Response',
      });

      expect(result).toBe(false);
    });

    it('returns false when augmenter is disabled', async () => {
      const disabledAugmenter = new GraphPromptAugmenter(mcpClientMock, providerMock, {
        enabled: false,
      });

      const result = await disabledAugmenter.storeExchange({
        originalPrompt: 'Test',
        llmResponse: 'Response',
      });

      expect(result).toBe(false);
      expect(mcpClientMock.callTool).not.toHaveBeenCalled();
    });
  });
});
