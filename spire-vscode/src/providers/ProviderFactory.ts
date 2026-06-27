import { ToolCallProvider } from './types.js';
import { HardCodedToolProvider } from './HardCodedToolProvider.js';

/**
 * Factory for creating ToolCallProvider instances.
 *
 * Supports provider types:
 * - 'hardcoded': Day 0 keyword-based provider
 * - 'llm': Future LLM-based provider
 * - 'fine-tuned': Future Graph-ToolFormer provider
 */
export class ProviderFactory {
  /**
   * Create a provider instance of the specified type.
   */
  static create(type: 'hardcoded' | 'llm' | 'fine-tuned'): ToolCallProvider {
    switch (type) {
      case 'hardcoded':
        return new HardCodedToolProvider();

      case 'llm':
        throw new Error(
          'LLMToolProvider is not yet implemented. ' +
          'Use "hardcoded" for the Day 0 provider.'
        );

      case 'fine-tuned':
        throw new Error(
          'FineTunedToolProvider is not yet implemented. ' +
          'Use "hardcoded" for the Day 0 provider.'
        );

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}
