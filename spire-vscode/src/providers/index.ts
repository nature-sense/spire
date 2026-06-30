/**
 * Provider module exports.
 *
 * The provider system determines which graph-memory MCP tool to call
 * based on the user's natural language prompt, then augments the prompt
 * with the retrieved graph context before passing it to the LLM.
 */

export { SessionProvider } from './SessionProvider';
export type { SessionProviderOptions, SessionDetails } from './SessionProvider';
export { _extractSessionDetails, _extractReference, _matchPatterns } from './SessionProvider';
export { ProviderFactory } from './ProviderFactory';
export { GraphQueryProvider } from './GraphQueryProvider';
export type {
  ProviderDecision,
  ToolCallProvider,
  ProviderInfo,
  AugmenterConfig,
} from './types';
export { DEFAULT_AUGMENTER_CONFIG } from './types';
