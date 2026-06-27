import { ILLMProvider } from '../core/interfaces/llm-provider';
import { DeepSeekProvider, DeepSeekConfig } from './deepseek/deepseek-provider';

export type ProviderType = 'deepseek' | 'openai' | 'anthropic' | 'ollama';

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export class ProviderFactory {
  static create(config: ProviderConfig): ILLMProvider {
    switch (config.type) {
      case 'deepseek':
        return new DeepSeekProvider({
          apiKey: config.apiKey || '',
          model: config.model || 'deepseek-chat',
          baseUrl: config.baseUrl,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          enableThinking: config.enableThinking ?? true,
          reasoningEffort: config.reasoningEffort ?? 'medium'
        });

      // Future providers can be added here
      // case 'openai':
      //   return new OpenAIProvider(config);
      // case 'anthropic':
      //   return new AnthropicProvider(config);
      // case 'ollama':
      //   return new OllamaProvider(config);

      default:
        throw new Error(`Unsupported provider type: ${config.type}`);
    }
  }

  static getDefaultConfig(): ProviderConfig {
    return {
      type: 'deepseek',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 8192,
      enableThinking: true,
      reasoningEffort: 'medium'
    };
  }
}
