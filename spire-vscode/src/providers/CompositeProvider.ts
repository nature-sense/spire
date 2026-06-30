/**
 * CompositeProvider — chains multiple ToolCallProviders together.
 *
 * Tries each provider in order and returns the first non-null decision
 * with confidence above the threshold. This allows composing the
 * GraphQueryProvider (graph queries) with the SessionProvider
 * (session management) into a single pipeline.
 *
 * FLOW:
 *   analyzePrompt(prompt)
 *     ├─ provider1.analyzePrompt(prompt)  → decision with confidence ≥ threshold? → return it
 *     ├─ provider2.analyzePrompt(prompt)  → decision with confidence ≥ threshold? → return it
 *     └─ ... → no match → return no-op decision
 */
import type { ProviderDecision, ToolCallProvider, ProviderInfo } from './types.js';

export class CompositeProvider implements ToolCallProvider {
  private providers: ToolCallProvider[];
  private confidenceThreshold: number;

  constructor(providers: ToolCallProvider[], confidenceThreshold = 0.5) {
    this.providers = providers;
    this.confidenceThreshold = confidenceThreshold;
  }

  analyzePrompt(prompt: string): ProviderDecision {
    for (const provider of this.providers) {
      const decision = provider.analyzePrompt(prompt);
      if (decision.toolName && decision.confidence >= this.confidenceThreshold) {
        console.log(
          `[CompositeProvider] Selected provider="${provider.getProviderInfo().name}" ` +
          `tool="${decision.toolName}" confidence=${decision.confidence.toFixed(2)}`
        );
        return decision;
      }
    }

    // No provider matched — return no-op
    return {
      toolName: undefined,
      arguments: {},
      originalPrompt: prompt,
      confidence: 0,
      reasoning: 'No provider matched this prompt',
      augmented: false,
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'CompositeProvider',
      version: '1.0.0',
      description: `Chains ${this.providers.length} providers: ${this.providers.map(p => p.getProviderInfo().name).join(', ')}`,
      supportedTools: this.providers.flatMap(p => p.getProviderInfo().supportedTools),
      confidenceThreshold: this.confidenceThreshold,
    };
  }

  /** Add a provider to the chain (appended to end). */
  addProvider(provider: ToolCallProvider): void {
    this.providers.push(provider);
  }

  /** Remove a provider by name. */
  removeProvider(name: string): void {
    this.providers = this.providers.filter(p => p.getProviderInfo().name !== name);
  }
}
