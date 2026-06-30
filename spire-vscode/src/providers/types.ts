/**
 * Provider types for the Graph Knowledge Augmentation system.
 *
 * The provider determines which graph-memory MCP tool to call based on
 * the user's natural language prompt, then augments the prompt with
 * the retrieved graph context before passing it to the LLM.
 *
 * STRATEGY PATTERN:
 * - GraphQueryProvider (Day 0): keyword matching for graph queries
 * - SessionProvider (Day 0): keyword/regex matching for session management
 * - LLMToolProvider (future): LLM-based tool selection
 * - FineTunedToolProvider (future): Graph-ToolFormer fine-tuned model
 */

/**
 * A decision made by a provider about which tool to call
 * and how to augment the prompt.
 */
export interface ProviderDecision {
  /** The tool name to call (e.g. "graph-memory__query_knowledge_graph") */
  toolName?: string;

  /** Arguments for the tool */
  arguments?: Record<string, any>;

  /** Original user prompt before augmentation */
  originalPrompt: string;

  /** Augmented prompt (after applying retrieved graph context) */
  augmentedPrompt?: string;

  /** Confidence score 0-1 */
  confidence: number;

  /** Human-readable reasoning for the decision */
  reasoning?: string;

  /** Whether augmentation was actually applied */
  augmented: boolean;
}

/**
 * The provider interface — implement this for different strategies.
 */
export interface ToolCallProvider {
  /**
   * Analyze a user prompt and determine:
   * 1. Which graph-memory tool to call (if any)
   * 2. What arguments to pass
   * 3. Whether augmentation should occur
   */
  analyzePrompt(prompt: string): ProviderDecision;

  /** Return metadata about this provider implementation */
  getProviderInfo(): ProviderInfo;
}

/**
 * Provider metadata
 */
export interface ProviderInfo {
  name: string;
  version: string;
  description: string;
  supportedTools: string[];
  confidenceThreshold?: number;
}

/**
 * Configuration for the Graph Prompt Augmenter
 */
export interface AugmenterConfig {
  /** Whether augmentation is enabled */
  enabled: boolean;

  /** Minimum confidence threshold to apply augmentation (0-1) */
  confidenceThreshold: number;

  /** Provider type to use */
  providerType: 'hardcoded' | 'llm' | 'fine-tuned';

  /** MCP server ID hosting the graph-memory tools */
  graphMemoryServerId: string;

  /** Maximum characters of graph context to include */
  maxContextLength: number;
}

export const DEFAULT_AUGMENTER_CONFIG: AugmenterConfig = {
  enabled: true,
  confidenceThreshold: 0.5,
  providerType: 'hardcoded',
  graphMemoryServerId: 'graph-memory',
  maxContextLength: 2000,
};
