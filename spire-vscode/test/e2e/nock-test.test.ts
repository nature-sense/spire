import { describe, it, expect } from 'vitest';
import nock from 'nock';
import * as https from 'https';
import * as http from 'http';

describe('nock in vitest', () => {
  it('should intercept https.request with full URL as first arg', async () => {
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
