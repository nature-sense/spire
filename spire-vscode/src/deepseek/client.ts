import * as vscode from 'vscode';
import { SpireConfig, Message, DeepSeekRequest, DeepSeekResponse } from './types';
import { loadMemoryBank } from '../context/memoryBank';
import { loadClineRules } from '../context/rules';

/**
 * DeepSeek API Client
 * Handles all communication with the DeepSeek API
 */
export class DeepSeekClient {
  private config: SpireConfig;

  constructor(config: SpireConfig) {
    this.config = config;
  }

  /**
   * Build the system prompt from Memory Bank and Cline rules
   */
  public async buildSystemPrompt(): Promise<string> {
    let prompt = `You are Spire, a coding assistant in VS Code. Help the user with their code.

## Your Capabilities
- Write, debug, and refactor code
- Explain code and concepts
- Suggest improvements and best practices
- Generate code in any language

## Guidelines
- Be concise and helpful
- Show code with proper formatting
- Ask clarifying questions when needed
- When suggesting file changes, show the full file content
`;

    // Add Memory Bank context if enabled
    if (this.config.useMemoryBank) {
      const memoryBank = await loadMemoryBank();
      const hasContent = Object.values(memoryBank).some(v => v && v.trim().length > 0);
      
      if (hasContent) {
        prompt += '\n## Project Context (Memory Bank)\n';
        for (const [key, value] of Object.entries(memoryBank)) {
          if (value && value.trim()) {
            prompt += `\n### ${key}\n${value}\n`;
          }
        }
      }
    }

    // Add Cline rules if enabled
    if (this.config.useClineRules) {
      const rules = await loadClineRules();
      if (rules && rules.trim()) {
        prompt += `\n## Coding Rules\n${rules}\n`;
      }
    }

    return prompt;
  }

  /**
   * Send a message to DeepSeek and get a response
   */
  public async sendMessage(messages: Message[], systemPrompt?: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('DeepSeek API key is not configured. Please set it in settings.');
    }

    // Build full message list with system prompt
    const fullMessages: Message[] = [];

    // Add system prompt if provided, or build one
    if (systemPrompt) {
      fullMessages.push({ role: 'system', content: systemPrompt });
    } else if (this.config.useMemoryBank || this.config.useClineRules) {
      const prompt = await this.buildSystemPrompt();
      fullMessages.push({ role: 'system', content: prompt });
    }

    fullMessages.push(...messages);

    // Build request body
    const requestBody: DeepSeekRequest = {
      model: this.config.model,
      messages: fullMessages,
      thinking: { type: 'disabled' }, // CRITICAL: Fixes V4 reasoning_content errors
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens
    };

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // Handle rate limiting
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        }
        
        // Handle authentication errors
        if (response.status === 401) {
          throw new Error('Invalid API key. Please check your DeepSeek API key.');
        }
        
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from DeepSeek API.');
      }

      return data.choices[0].message.content;

    } catch (error) {
      // Re-throw with better message
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error occurred while calling DeepSeek API.');
    }
  }

  /**
   * Send a message with retry logic
   */
  public async sendMessageWithRetry(
    messages: Message[],
    systemPrompt?: string,
    maxRetries: number = 3
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.sendMessage(messages, systemPrompt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on auth errors
        if (lastError.message.includes('API key')) {
          throw lastError;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Check if the API key is valid
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.sendMessage([
        { role: 'user', content: 'Hello, respond with "OK" only.' }
      ], 'You are a test assistant. Respond with "OK" only.');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Load configuration from VS Code settings
 */
export function loadConfig(): SpireConfig {
  const config = vscode.workspace.getConfiguration('spire');
  
  return {
    apiKey: config.get('apiKey', ''),
    model: config.get('model', 'deepseek-v4-flash'),
    disableThinking: config.get('disableThinking', true),
    temperature: config.get('temperature', 0.7),
    maxTokens: config.get('maxTokens', 4096),
    useMemoryBank: config.get('useMemoryBank', false),
    useClineRules: config.get('useClineRules', false)
  };
}

/**
 * 
 * Get workspace root path
 */
export function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}