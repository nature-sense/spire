import { IMcpClient } from '../core/interfaces/mcp-client.js';
import {
  ToolCallProvider,
  ProviderDecision,
  AugmenterConfig,
  DEFAULT_AUGMENTER_CONFIG,
} from '../providers/types.js';

/**
 * Graph Prompt Augmenter.
 *
 * Orchestrates the flow:
 *   1. Takes a user prompt
 *   2. Passes it through the ToolCallProvider (which decides which graph-memory
 *      MCP tool to call and what arguments to use)
 *   3. Executes the tool call via MCP
 *   4. Augments the original prompt with the retrieved graph context
 *   5. Returns the augmented prompt to be sent to the LLM
 *
 * FLOW:
 *   User Prompt → Provider.analyzePrompt() → MCP.callTool() → Prompt + Context → LLM
 *
 * This is a pure middleware — the existing orchestrator/workflow/LLM pipeline
 * is untouched. The augmentation just enriches the input text.
 */
export class GraphPromptAugmenter {
  private provider: ToolCallProvider;
  private mcpClient: IMcpClient;
  private config: AugmenterConfig;

  constructor(
    mcpClient: IMcpClient,
    provider: ToolCallProvider,
    config?: Partial<AugmenterConfig>
  ) {
    this.mcpClient = mcpClient;
    this.provider = provider;
    this.config = { ...DEFAULT_AUGMENTER_CONFIG, ...config };
  }

  /**
   * Process a user prompt: analyze, call MCP tool, and augment with graph context.
   *
   * @param prompt - The user's original input
   * @returns The augmented prompt (or the original if no tool matched)
   */
  async processPrompt(prompt: string): Promise<string> {
    if (!this.config.enabled) {
      console.log('[GraphPromptAugmenter] Disabled — returning original prompt');
      return prompt;
    }

    const startTime = Date.now();

    try {
      // Step 1: Let the provider analyze and decide which tool to call
      const decision: ProviderDecision = this.provider.analyzePrompt(prompt);

      // Step 2: If confidence is below threshold, skip augmentation
      if (!decision.toolName || decision.confidence < this.config.confidenceThreshold) {
        console.log(
          `[GraphPromptAugmenter] Skipping — ` +
          `tool=${decision.toolName || 'none'}, ` +
          `confidence=${decision.confidence.toFixed(2)}, ` +
          `threshold=${this.config.confidenceThreshold}`
        );
        return prompt;
      }

      // Step 3: Call the graph-memory tool via MCP
      const toolResult = await this.callGraphMemoryTool(decision);

      // Step 4: If the call succeeded and returned content, augment the prompt
      if (toolResult.success && toolResult.content) {
        const augmented = this.buildAugmentedPrompt(
          prompt,
          toolResult.content,
          decision
        );
        decision.augmented = true;

        const elapsed = Date.now() - startTime;
        console.log(
          `[GraphPromptAugmenter] ✅ Augmented with ${toolResult.content.length} chars ` +
          `from ${decision.toolName} (${elapsed}ms)`
        );
        return augmented;
      }

      // Step 5: Tool call failed silently — return original prompt
      if (toolResult.error) {
        console.warn(
          `[GraphPromptAugmenter] ⚠️ Tool ${decision.toolName} error: ${toolResult.error}`
        );
      }

      return prompt;
    } catch (error) {
      // Graceful degradation: return the original prompt on any error
      console.error(
        '[GraphPromptAugmenter] ❌ Error during augmentation:',
        (error as Error).message
      );
      return prompt;
    }
  }

  /**
   * Switch to a different provider at runtime (e.g. for A/B testing).
   */
  setProvider(provider: ToolCallProvider): void {
    this.provider = provider;
    console.log(
      `[GraphPromptAugmenter] Switched provider to: ${provider.getProviderInfo().name}`
    );
  }

  /** Get the current provider info. */
  getProviderInfo() {
    return this.provider.getProviderInfo();
  }

  /** Enable or disable the augmenter at runtime. */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[GraphPromptAugmenter] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  // ───── Private Helpers ─────

  /**
   * Call the graph-memory MCP tool and return the result.
   */
  private async callGraphMemoryTool(
    decision: ProviderDecision
  ): Promise<{ content: string; success: boolean; error?: string }> {
    const toolName = decision.toolName!;
    const args = decision.arguments;

    console.log(
      `[GraphPromptAugmenter] Calling MCP tool: ${toolName}`,
      args ? JSON.stringify(args) : '(no args)'
    );

    const result = await this.mcpClient.callTool(toolName, args);
    return result;
  }

  /**
   * Build the augmented prompt with graph context in HTML-style comments.
   */
  private buildAugmentedPrompt(
    original: string,
    graphContext: string,
    decision: ProviderDecision
  ): string {
    const trimmedContext = this.truncateContext(graphContext);
    const sections: string[] = [];

    // Start with the original prompt
    sections.push(original);

    // Add the graph context section
    sections.push('');
    sections.push('<!-- Graph Knowledge Context -->');
    sections.push(
      `The following was retrieved from the knowledge graph ` +
      `(via ${decision.toolName}, ${(decision.confidence * 100).toFixed(0)}% confidence):`
    );
    sections.push('');
    sections.push(trimmedContext);
    sections.push('');
    sections.push(
      'Use this context to inform your response if relevant to the query above.'
    );
    sections.push('<!-- /Graph Knowledge Context -->');

    return sections.join('\n');
  }

  /** Truncate context to the maximum configured length. */
  private truncateContext(context: string): string {
    if (context.length <= this.config.maxContextLength) {
      return context;
    }
    return (
      context.substring(0, this.config.maxContextLength) +
      `\n\n... [context truncated at ${this.config.maxContextLength} characters]`
    );
  }
}
