import { Tool } from './tool';
import { WorkspaceContext } from './context';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Conversation {
  messages: Message[];
  context?: WorkspaceContext;
}

export interface SendOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_calls' | 'length';
}
