import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test' } }],
    getConfiguration: () => ({
      get: () => null,
    }),
  },
  window: {
    showInformationMessage: vi.fn(),
    createOutputChannel: () => ({ appendLine: vi.fn(), show: vi.fn() }),
    createStatusBarItem: () => ({ show: vi.fn(), dispose: vi.fn() }),
  },
  ExtensionContext: class {},
  StatusBarAlignment: { Left: 1, Right: 2 },
  events: {},
}));

import nock from 'nock';
import * as https from 'https';

describe('nock with vi.mock(vscode)', () => {
  it('should still intercept', async () => {
    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(200, { choices: [{ message: { content: 'works' } }] });

    const result = await new Promise<any>((resolve, reject) => {
      const url = 'https://api.deepseek.com/v1/chat/completions';
      const payload = JSON.stringify({ test: true });
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 5000
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode, body: data });
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).choices[0].message.content).toBe('works');
  });
});
