export function isoTimestamp(): string {
  return new Date().toISOString();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

import * as crypto from 'crypto';

export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}
