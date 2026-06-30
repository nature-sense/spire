import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { DeepSeekProvider } from '../../../src/llm/deepseek/deepseek-provider';
import { Message, SendOptions } from '../../../src/core/models/message';
import { ProviderError } from '../../../src/core/errors/errors';

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;
  
  beforeEach(() => {
    provider = new DeepSeekProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 1000,
    });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('sendMessage() should format request correctly and parse response', async () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    
    nock('https://api.deepseek.com')
      .post('/v1/chat/completions', (body) => {
        expect(body.model).toBe('deepseek-chat');
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].content).toBe('Hello');
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hi there!'
            }
          }
        ]
      });

    const response = await provider.sendMessage(messages);
    expect(response.content).toBe('Hi there!');
    expect(response.toolCalls).toBeUndefined();
  });

  it('sendMessage() should format tools into request schema', async () => {
    const messages: Message[] = [{ role: 'user', content: 'What is 2+2?' }];
    const options: SendOptions = {
      tools: [
        {
          name: 'calculate',
          description: 'Calculates math',
          parameters: {
            type: 'object',
            properties: { expression: { type: 'string' } },
            required: ['expression']
          },
          execute: async () => '4'
        }
      ]
    };

    nock('https://api.deepseek.com')
      .post('/v1/chat/completions', (body) => {
        expect(body.tools).toBeDefined();
        expect(body.tools[0].function.name).toBe('calculate');
        expect(body.tools[0].function.description).toBe('Calculates math');
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I will calculate that.',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'calculate',
                    arguments: '{"expression": "2+2"}'
                  }
                }
              ]
            }
          }
        ]
      });

    const response = await provider.sendMessage(messages, options);
    expect(response.content).toBe('I will calculate that.');
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls![0].function.name).toBe('calculate');
    expect(response.toolCalls![0].function.arguments).toBe('{"expression": "2+2"}');
  });

  it('sendMessage() should throw ProviderError on HTTP error', async () => {
    nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(401, { error: { message: 'Invalid API Key' } });

    await expect(provider.sendMessage([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow(ProviderError);
  });

  it('validateApiKey() should return true for 200 OK', async () => {
    nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [
          { message: { role: 'assistant', content: 'OK' } }
        ]
      });

    const isValid = await provider.validateApiKey('valid-key');
    expect(isValid).toBe(true);
  });

  it('validateApiKey() should return false for 401 Unauthorized', async () => {
    nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(401, { error: 'invalid key' });

    const isValid = await provider.validateApiKey('invalid-key');
    expect(isValid).toBe(false);
  });
});
