export interface SpireConfig {
  apiKey: string;
  model: string;
  disableThinking: boolean;
  temperature: number;
  maxTokens: number;
  useMemoryBank: boolean;
  useClineRules: boolean;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface DeepSeekRequest {
  model: string;
  messages: Message[];
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  thinking?: {
    type: 'disabled';
  };
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface MemoryBankContent {
  [filename: string]: string;
}

export interface FileOperationResult {
  success: boolean;
  error?: string;
  path?: string;
  content?: string;
}

export interface WebviewMessage {
  type: 'sendMessage' | 'clearHistory' | 'updateConfig' | 'loadContext';
  payload?: any;
}
