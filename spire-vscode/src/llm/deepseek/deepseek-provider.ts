import * as https from 'https';
import * as http from 'http';
import { ILLMProvider } from '../../core/interfaces/llm-provider';
import { Message, SendOptions, LLMResponse } from '../../core/models/message';
import { Tool } from '../../core/models/tool';
import { ProviderError } from '../../core/errors/errors';

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/** Default model for DeepSeek V4 */
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';
/** Default base URL for DeepSeek API */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

/** Retry configuration */
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10000;

export class DeepSeekProvider implements ILLMProvider {
  private config: DeepSeekConfig;

  constructor(config: DeepSeekConfig) {
    this.config = config;
  }

  async sendMessage(messages: Message[], options?: SendOptions): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new ProviderError('DeepSeek API key is not configured');
    }

    const baseUrl = this.config.baseUrl || DEEPSEEK_BASE_URL;
    const fullMessages = this.prepareMessages(messages, options?.systemPrompt);
    const requestBody = this.buildRequest(fullMessages, options);

    let lastError: Error | null = null;

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const data = await this.httpRequest(baseUrl, requestBody);
        return this.parseResponse(data);
      } catch (error) {
        if (error instanceof ProviderError) {
          // Don't retry on auth errors (401) or bad request (400, 422)
          const statusMatch = error.message.match(/API error \((\d+)\)/);
          if (statusMatch) {
            const statusCode = parseInt(statusMatch[1], 10);
            if (statusCode === 401 || statusCode === 400 || statusCode === 422) {
              throw error;
            }
            // For rate limits (429) and server errors (5xx), retry
            if (statusCode !== 429 && (statusCode < 500 || statusCode >= 600)) {
              throw error;
            }
          } else if (!error.message.includes('timeout') && !error.message.includes('ECONNRESET')) {
            // Only retry on timeout/connection reset/server errors
            throw error;
          }
        }
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < RETRY_MAX_ATTEMPTS) {
          const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new ProviderError(`Request failed after ${RETRY_MAX_ATTEMPTS} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  private httpRequest(url: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const mod = isHttps ? https : http;

      const payload = JSON.stringify(body);

      const req = mod.request(
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Accept': 'application/json'
          },
          timeout: 60000
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString();
            if (!res.statusCode || res.statusCode >= 400) {
              reject(new ProviderError(`API error (${res.statusCode}): ${data.slice(0, 500)}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new ProviderError(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(new ProviderError(`Request failed: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new ProviderError('Request timed out after 60s'));
      });
      req.write(payload);
      req.end();
    });
  }

  private prepareMessages(messages: Message[], systemPrompt?: string): Message[] {
    const result: Message[] = [];
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }
    result.push(...messages);
    return result;
  }

  private buildRequest(messages: Message[], options?: SendOptions): any {
    const tools = options?.tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    // DeepSeek V4 uses `deepseek-reasoner` for the reasoning model
    // and `deepseek-chat` for the standard chat model
    const model = this.config.model || DEEPSEEK_DEFAULT_MODEL;

    const requestBody: any = {
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls,
        tool_call_id: m.toolCallId
      })),
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? (options?.toolChoice || 'auto') : undefined
    };

    // DeepSeek V4 native thinking (reasoning) support
    // V4 supports reasoning_effort on deepseek-chat, deepseek-reasoner,
    // and deepseek-latest — omit the param entirely when thinking is
    // disabled so V4 doesn't waste tokens on internal deliberation.
    const thinkingEnabled = this.config.enableThinking ?? true;

    if (thinkingEnabled) {
      const effort = this.config.reasoningEffort || 'medium';
      requestBody.reasoning_effort = effort;
    }
    // When thinking is disabled, do NOT set reasoning_effort at all.
    // Setting reasoning_effort = 'low' would still trigger some thinking
    // tokens, which wastes budget for non-thinking use-cases.

    return requestBody;
  }

  private parseResponse(data: any): LLMResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError('No response from DeepSeek API');
    }

    const message = choice.message || {};

    // DeepSeek V4 returns `reasoning_content` alongside `content` for reasoning models
    // This contains the chain-of-thought tokens
    const reasoning = message.reasoning_content || undefined;

    return {
      content: message.content || '',
      reasoning,
      toolCalls: message.tool_calls?.map((tc: any) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      })),
      finishReason: choice.finish_reason
    };
  }

  async listModels(): Promise<string[]> {
    return ['deepseek-chat', 'deepseek-reasoner'];
  }

  async validateApiKey(key: string): Promise<boolean> {
    try {
      const testProvider = new DeepSeekProvider({
        ...this.config,
        apiKey: key,
        model: 'deepseek-chat',
        enableThinking: false
      });
      await testProvider.sendMessage(
        [{ role: 'user', content: 'ping' }],
        { systemPrompt: 'Respond with "OK" only.' }
      );
      return true;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return 'DeepSeek';
  }
}
