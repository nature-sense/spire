import { describe, it, expect, vi } from 'vitest';
import { CompositeProvider } from '../../../src/providers/CompositeProvider';
import { ToolCallProvider, ProviderDecision } from '../../../src/providers/types';

function createMockProvider(name: string, supportedTools: string[]) {
  return {
    analyzePrompt: vi.fn(),
    getProviderInfo: vi.fn().mockReturnValue({
      name,
      version: '1.0.0',
      description: `Mock ${name}`,
      supportedTools,
      confidenceThreshold: 0.5,
    }),
  } as unknown as ToolCallProvider;
}

function makeDecision(overrides: Partial<ProviderDecision> = {}): ProviderDecision {
  return {
    toolName: undefined,
    arguments: {},
    originalPrompt: 'test',
    confidence: 0,
    augmented: false,
    ...overrides,
  };
}

describe('CompositeProvider', () => {
  it('returns the first matching provider decision when confidence >= threshold', () => {
    const p1 = createMockProvider('Provider1', ['tool-a']);
    const p2 = createMockProvider('Provider2', ['tool-b']);

    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'tool-a', confidence: 0.8 })
    );

    const composite = new CompositeProvider([p1, p2], 0.5);
    const result = composite.analyzePrompt('test');

    expect(result.toolName).toBe('tool-a');
    expect(result.confidence).toBe(0.8);
    expect(p1.analyzePrompt).toHaveBeenCalledWith('test');
    expect(p2.analyzePrompt).not.toHaveBeenCalled();
  });

  it('falls through to the next provider when confidence is below threshold', () => {
    const p1 = createMockProvider('Provider1', ['tool-a']);
    const p2 = createMockProvider('Provider2', ['tool-b']);

    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'tool-a', confidence: 0.3 })
    );
    vi.mocked(p2.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'tool-b', confidence: 0.9 })
    );

    const composite = new CompositeProvider([p1, p2], 0.5);
    const result = composite.analyzePrompt('test');

    expect(result.toolName).toBe('tool-b');
    expect(p1.analyzePrompt).toHaveBeenCalled();
    expect(p2.analyzePrompt).toHaveBeenCalled();
  });

  it('skips providers that return no toolName even with high confidence', () => {
    const p1 = createMockProvider('Provider1', ['tool-a']);
    const p2 = createMockProvider('Provider2', ['tool-b']);

    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: undefined, confidence: 0.9 })
    );
    vi.mocked(p2.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'tool-b', confidence: 0.8 })
    );

    const composite = new CompositeProvider([p1, p2], 0.5);
    const result = composite.analyzePrompt('test');

    expect(result.toolName).toBe('tool-b');
  });

  it('returns a no-op decision when no provider matches', () => {
    const p1 = createMockProvider('Provider1', ['tool-a']);
    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: undefined, confidence: 0 })
    );

    const composite = new CompositeProvider([p1], 0.5);
    const result = composite.analyzePrompt('hello');

    expect(result.toolName).toBeUndefined();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe('No provider matched this prompt');
    expect(result.augmented).toBe(false);
  });

  it('uses custom confidence threshold', () => {
    const p1 = createMockProvider('Provider1', ['tool-a']);
    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'tool-a', confidence: 0.6 })
    );

    // Threshold 0.7 — should reject 0.6
    const composite = new CompositeProvider([p1], 0.7);
    const result = composite.analyzePrompt('test');

    expect(result.toolName).toBeUndefined();
  });

  it('addProvider() appends a provider to the chain', () => {
    const p1 = createMockProvider('P1', ['a']);
    const p2 = createMockProvider('P2', ['b']);
    const composite = new CompositeProvider([p1], 0.5);

    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: undefined, confidence: 0 })
    );

    composite.addProvider(p2);
    vi.mocked(p2.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'b', confidence: 0.9 })
    );

    const result = composite.analyzePrompt('test');
    expect(result.toolName).toBe('b');
  });

  it('removeProvider() removes a provider by name', () => {
    const p1 = createMockProvider('P1', ['a']);
    const p2 = createMockProvider('P2', ['b']);
    const composite = new CompositeProvider([p1, p2], 0.5);

    vi.mocked(p1.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: undefined, confidence: 0 })
    );
    vi.mocked(p2.analyzePrompt).mockReturnValue(
      makeDecision({ toolName: 'b', confidence: 0.9 })
    );

    composite.removeProvider('P2');
    const result = composite.analyzePrompt('test');

    expect(result.toolName).toBeUndefined();
    expect(p2.analyzePrompt).not.toHaveBeenCalled();
  });

  it('getProviderInfo() reports all chained providers', () => {
    const p1 = createMockProvider('P1', ['a', 'b']);
    const p2 = createMockProvider('P2', ['c']);
    const composite = new CompositeProvider([p1, p2], 0.5);

    const info = composite.getProviderInfo();

    expect(info.name).toBe('CompositeProvider');
    expect(info.version).toBe('1.0.0');
    expect(info.description).toContain('P1');
    expect(info.description).toContain('P2');
    expect(info.supportedTools).toEqual(['a', 'b', 'c']);
    expect(info.confidenceThreshold).toBe(0.5);
  });
});
