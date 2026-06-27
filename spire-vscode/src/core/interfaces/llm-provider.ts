import { Message, SendOptions, LLMResponse } from '../models/message';
import { Tool } from '../models/tool';

export interface ILLMProvider {
  sendMessage(
    messages: Message[],
    options?: SendOptions
  ): Promise<LLMResponse>;

  listModels(): Promise<string[]>;

  validateApiKey(key: string): Promise<boolean>;

  getProviderName(): string;
}

export const ILLMProvider = Symbol('ILLMProvider');
