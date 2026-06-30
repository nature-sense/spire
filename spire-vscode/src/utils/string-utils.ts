import * as crypto from 'crypto';

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cypherStr(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function generateId(): string {
  return crypto.randomUUID();
}
