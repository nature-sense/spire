import { describe, it, expect } from 'vitest';
import {
  deterministicSort,
  compareStrings,
  compareNumbers,
  compareDates,
  compareBooleans,
  compareByKey,
  compareByNumberKey,
  compareByDateKey,
  compareByBooleanKey,
  composeComparators,
  compareNodes,
  compareRelationships,
} from '../../../src/utils/deterministic-sort';
import { Node, Relationship } from '../../../src/core/interfaces/memory';

// ============================================================================
// Base Comparators
// ============================================================================

describe('compareStrings', () => {
  it('returns -1 when a < b', () => {
    expect(compareStrings('apple', 'banana')).toBeLessThan(0);
  });

  it('returns 1 when a > b', () => {
    expect(compareStrings('banana', 'apple')).toBeGreaterThan(0);
  });

  it('returns 0 when a === b', () => {
    expect(compareStrings('same', 'same')).toBe(0);
  });

  it('is case-sensitive by default', () => {
    expect(compareStrings('A', 'a')).not.toBe(0);
  });

  it('handles empty strings', () => {
    expect(compareStrings('', 'a')).toBeLessThan(0);
    expect(compareStrings('a', '')).toBeGreaterThan(0);
    expect(compareStrings('', '')).toBe(0);
  });

  it('handles special characters', () => {
    expect(compareStrings('hello-world', 'hello_world')).not.toBe(0);
  });
});

describe('compareNumbers', () => {
  it('returns -1 when a < b', () => {
    expect(compareNumbers(1, 2)).toBe(-1);
  });

  it('returns 1 when a > b', () => {
    expect(compareNumbers(2, 1)).toBe(1);
  });

  it('returns 0 when a === b', () => {
    expect(compareNumbers(42, 42)).toBe(0);
  });

  it('handles negative numbers', () => {
    expect(compareNumbers(-5, -3)).toBe(-1);
    expect(compareNumbers(-3, -5)).toBe(1);
  });

  it('handles zero', () => {
    expect(compareNumbers(0, 0)).toBe(0);
    expect(compareNumbers(-1, 0)).toBe(-1);
  });

  it('handles floating point', () => {
    expect(compareNumbers(1.5, 1.5)).toBe(0);
    expect(compareNumbers(1.4, 1.5)).toBe(-1);
  });
});

describe('compareDates', () => {
  it('returns -1 when a < b', () => {
    const a = new Date('2024-01-01');
    const b = new Date('2024-06-15');
    expect(compareDates(a, b)).toBe(-1);
  });

  it('returns 1 when a > b', () => {
    const a = new Date('2024-06-15');
    const b = new Date('2024-01-01');
    expect(compareDates(a, b)).toBe(1);
  });

  it('returns 0 when a === b', () => {
    const a = new Date('2024-01-01T12:00:00Z');
    const b = new Date('2024-01-01T12:00:00Z');
    expect(compareDates(a, b)).toBe(0);
  });

  it('handles same day different time', () => {
    const a = new Date('2024-01-01T10:00:00Z');
    const b = new Date('2024-01-01T12:00:00Z');
    expect(compareDates(a, b)).toBe(-1);
  });
});

describe('compareBooleans', () => {
  it('returns -1 when false < true', () => {
    expect(compareBooleans(false, true)).toBe(-1);
  });

  it('returns 1 when true > false', () => {
    expect(compareBooleans(true, false)).toBe(1);
  });

  it('returns 0 when both false', () => {
    expect(compareBooleans(false, false)).toBe(0);
  });

  it('returns 0 when both true', () => {
    expect(compareBooleans(true, true)).toBe(0);
  });
});

// ============================================================================
// deterministicSort
// ============================================================================

describe('deterministicSort', () => {
  it('sorts strings alphabetically', () => {
    const input = ['banana', 'apple', 'cherry'];
    const result = deterministicSort(input, compareStrings);
    expect(result).toEqual(['apple', 'banana', 'cherry']);
  });

  it('does NOT mutate the original array', () => {
    const input = ['banana', 'apple', 'cherry'];
    const original = [...input];
    deterministicSort(input, compareStrings);
    expect(input).toEqual(original);
  });

  it('returns a new array (not the same reference)', () => {
    const input = ['banana', 'apple'];
    const result = deterministicSort(input, compareStrings);
    expect(result).not.toBe(input);
  });

  it('handles empty array', () => {
    expect(deterministicSort([], compareStrings)).toEqual([]);
  });

  it('handles single element array', () => {
    expect(deterministicSort(['only'], compareStrings)).toEqual(['only']);
  });

  it('is stable: same input always produces same output', () => {
    const input = ['z', 'a', 'm', 'b', 'c'];
    const run1 = deterministicSort(input, compareStrings);
    const run2 = deterministicSort(input, compareStrings);
    const run3 = deterministicSort(input, compareStrings);
    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  it('sorts numbers', () => {
    const input = [5, 2, 8, 1, 9];
    expect(deterministicSort(input, compareNumbers)).toEqual([1, 2, 5, 8, 9]);
  });

  it('sorts dates chronologically', () => {
    const input = [
      new Date('2024-06-01'),
      new Date('2024-01-01'),
      new Date('2024-03-15'),
    ];
    const result = deterministicSort(input, compareDates);
    expect(result).toEqual([
      new Date('2024-01-01'),
      new Date('2024-03-15'),
      new Date('2024-06-01'),
    ]);
  });
});

// ============================================================================
// compareByKey / compareByNumberKey / compareByDateKey / compareByBooleanKey
// ============================================================================

describe('compareByKey', () => {
  it('sorts objects by a string key', () => {
    const items = [
      { name: 'zebra' },
      { name: 'apple' },
      { name: 'mango' },
    ];
    const sorted = deterministicSort(items, compareByKey((x) => x.name));
    expect(sorted.map((x) => x.name)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('handles objects with same key', () => {
    const items = [
      { name: 'same', id: 2 },
      { name: 'same', id: 1 },
    ];
    const sorted = deterministicSort(items, compareByKey((x) => x.name));
    // compareByKey alone doesn't break ties — order is preserved from [...items].sort
    expect(sorted.length).toBe(2);
  });

  it('works with nested keys', () => {
    const items = [
      { meta: { path: '/src/b.ts' } },
      { meta: { path: '/src/a.ts' } },
    ];
    const sorted = deterministicSort(items, compareByKey((x) => x.meta.path));
    expect(sorted[0].meta.path).toBe('/src/a.ts');
    expect(sorted[1].meta.path).toBe('/src/b.ts');
  });
});

describe('compareByNumberKey', () => {
  it('sorts objects by a number key', () => {
    const items = [
      { priority: 3 },
      { priority: 1 },
      { priority: 2 },
    ];
    const sorted = deterministicSort(items, compareByNumberKey((x) => x.priority));
    expect(sorted.map((x) => x.priority)).toEqual([1, 2, 3]);
  });
});

describe('compareByDateKey', () => {
  it('sorts objects by a Date key', () => {
    const items = [
      { timestamp: new Date('2024-06-01') },
      { timestamp: new Date('2024-01-01') },
      { timestamp: new Date('2024-03-15') },
    ];
    const sorted = deterministicSort(items, compareByDateKey((x) => x.timestamp));
    expect(sorted.map((x) => x.timestamp.getTime())).toEqual([
      new Date('2024-01-01').getTime(),
      new Date('2024-03-15').getTime(),
      new Date('2024-06-01').getTime(),
    ]);
  });
});

describe('compareByBooleanKey', () => {
  it('sorts objects by a boolean key (false first)', () => {
    const items = [
      { active: true },
      { active: false },
      { active: true },
    ];
    const sorted = deterministicSort(items, compareByBooleanKey((x) => x.active));
    expect(sorted[0].active).toBe(false);
    expect(sorted[1].active).toBe(true);
    expect(sorted[2].active).toBe(true);
  });
});

// ============================================================================
// composeComparators
// ============================================================================

describe('composeComparators', () => {
  it('sorts by primary key, then secondary key', () => {
    interface Item {
      type: string;
      name: string;
    }
    const items: Item[] = [
      { type: 'fruit', name: 'apple' },
      { type: 'animal', name: 'zebra' },
      { type: 'fruit', name: 'banana' },
      { type: 'animal', name: 'aardvark' },
    ];
    const cmp = composeComparators(
      compareByKey((x: Item) => x.type),
      compareByKey((x: Item) => x.name),
    );
    const sorted = deterministicSort(items, cmp);
    expect(sorted.map((x) => `${x.type}:${x.name}`)).toEqual([
      'animal:aardvark',
      'animal:zebra',
      'fruit:apple',
      'fruit:banana',
    ]);
  });

  it('sorts by three keys', () => {
    interface Item {
      a: string;
      b: string;
      c: string;
    }
    const items: Item[] = [
      { a: 'x', b: 'y', c: 'z' },
      { a: 'x', b: 'y', c: 'a' },
      { a: 'x', b: 'a', c: 'z' },
    ];
    const cmp = composeComparators(
      compareByKey((x: Item) => x.a),
      compareByKey((x: Item) => x.b),
      compareByKey((x: Item) => x.c),
    );
    const sorted = deterministicSort(items, cmp);
    expect(sorted.map((x) => `${x.a}${x.b}${x.c}`)).toEqual([
      'xaz',
      'xya',
      'xyz',
    ]);
  });

  it('returns 0 when all comparators return 0', () => {
    const cmp = composeComparators(
      compareByKey((x: { id: string }) => x.id),
      compareByKey((x: { id: string }) => x.id),
    );
    expect(cmp({ id: 'same' }, { id: 'same' })).toBe(0);
  });
});

// ============================================================================
// Memory-Graph Comparators
// ============================================================================

describe('compareNodes', () => {
  const makeNode = (overrides: Partial<Node>): Node => ({
    id: '00000000-0000-0000-0000-000000000000',
    type: 'entity',
    name: 'default',
    properties: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    version: 1,
    ...overrides,
  });

  it('sorts by type first', () => {
    const a = makeNode({ type: 'entity', name: 'same' });
    const b = makeNode({ type: 'project', name: 'same' });
    expect(compareNodes(a, b)).toBeLessThan(0);
    expect(compareNodes(b, a)).toBeGreaterThan(0);
  });

  it('sorts by name when type is the same', () => {
    const a = makeNode({ type: 'entity', name: 'apple' });
    const b = makeNode({ type: 'entity', name: 'banana' });
    expect(compareNodes(a, b)).toBeLessThan(0);
  });

  it('sorts by id when type and name are the same', () => {
    const a = makeNode({ type: 'entity', name: 'same', id: 'a' });
    const b = makeNode({ type: 'entity', name: 'same', id: 'b' });
    expect(compareNodes(a, b)).toBeLessThan(0);
  });

  it('returns 0 for identical nodes', () => {
    const a = makeNode({ id: 'same-id', type: 'entity', name: 'same' });
    const b = makeNode({ id: 'same-id', type: 'entity', name: 'same' });
    expect(compareNodes(a, b)).toBe(0);
  });

  it('sorts a mixed array deterministically', () => {
    const nodes = [
      makeNode({ type: 'project', name: 'My Project', id: 'c' }),
      makeNode({ type: 'entity', name: 'auth.ts', id: 'b' }),
      makeNode({ type: 'entity', name: 'main.ts', id: 'a' }),
      makeNode({ type: 'project', name: 'Another Project', id: 'd' }),
    ];
    const sorted = deterministicSort(nodes, compareNodes);
    expect(sorted.map((n) => `${n.type}:${n.name}`)).toEqual([
      'entity:auth.ts',
      'entity:main.ts',
      'project:Another Project',
      'project:My Project',
    ]);
  });

  it('produces the same order regardless of input order', () => {
    const nodes = [
      makeNode({ type: 'entity', name: 'c', id: '1' }),
      makeNode({ type: 'entity', name: 'a', id: '2' }),
      makeNode({ type: 'entity', name: 'b', id: '3' }),
    ];
    const shuffled = [
      makeNode({ type: 'entity', name: 'b', id: '3' }),
      makeNode({ type: 'entity', name: 'c', id: '1' }),
      makeNode({ type: 'entity', name: 'a', id: '2' }),
    ];
    expect(deterministicSort(nodes, compareNodes)).toEqual(
      deterministicSort(shuffled, compareNodes)
    );
  });
});

describe('compareRelationships', () => {
  const makeRel = (overrides: Partial<Relationship>): Relationship => ({
    id: '00000000-0000-0000-0000-000000000000',
    type: 'depends_on',
    fromId: 'node-a',
    toId: 'node-b',
    properties: {},
    createdAt: new Date('2024-01-01'),
    ...overrides,
  });

  it('sorts by type first', () => {
    const a = makeRel({ type: 'active_context' });
    const b = makeRel({ type: 'depends_on' });
    expect(compareRelationships(a, b)).toBeLessThan(0);
  });

  it('sorts by fromId when type is the same', () => {
    const a = makeRel({ type: 'depends_on', fromId: 'a' });
    const b = makeRel({ type: 'depends_on', fromId: 'b' });
    expect(compareRelationships(a, b)).toBeLessThan(0);
  });

  it('sorts by toId when type and fromId are the same', () => {
    const a = makeRel({ type: 'depends_on', fromId: 'same', toId: 'a' });
    const b = makeRel({ type: 'depends_on', fromId: 'same', toId: 'b' });
    expect(compareRelationships(a, b)).toBeLessThan(0);
  });

  it('sorts by id when type, fromId, and toId are the same', () => {
    const a = makeRel({ type: 'depends_on', fromId: 'same', toId: 'same', id: 'a' });
    const b = makeRel({ type: 'depends_on', fromId: 'same', toId: 'same', id: 'b' });
    expect(compareRelationships(a, b)).toBeLessThan(0);
  });

  it('returns 0 for identical relationships', () => {
    const a = makeRel({ id: 'same-id', type: 'depends_on', fromId: 'a', toId: 'b' });
    const b = makeRel({ id: 'same-id', type: 'depends_on', fromId: 'a', toId: 'b' });
    expect(compareRelationships(a, b)).toBe(0);
  });

  it('sorts a mixed array deterministically', () => {
    const rels = [
      makeRel({ type: 'depends_on', fromId: 'b', toId: 'c' }),
      makeRel({ type: 'active_context', fromId: 'a', toId: 'b' }),
      makeRel({ type: 'depends_on', fromId: 'a', toId: 'b' }),
    ];
    const sorted = deterministicSort(rels, compareRelationships);
    expect(sorted.map((r) => `${r.type}:${r.fromId}->${r.toId}`)).toEqual([
      'active_context:a->b',
      'depends_on:a->b',
      'depends_on:b->c',
    ]);
  });
});

// ============================================================================
// Real-World Scenario: Prompt Serialisation Stability
// ============================================================================

describe('prompt serialisation stability', () => {
  it('produces identical JSON output for the same set of nodes regardless of input order', () => {
    const makeNode = (overrides: Partial<Node>): Node => ({
      id: 'id',
      type: 'entity',
      name: 'name',
      properties: {},
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      version: 1,
      ...overrides,
    });

    const setA = [
      makeNode({ type: 'project', name: 'Spire', id: '1' }),
      makeNode({ type: 'entity', name: 'main.ts', id: '2' }),
      makeNode({ type: 'decision', name: 'Use TypeScript', id: '3' }),
      makeNode({ type: 'blocker', name: 'Bug in parser', id: '4' }),
    ];

    const setB = [
      makeNode({ type: 'blocker', name: 'Bug in parser', id: '4' }),
      makeNode({ type: 'project', name: 'Spire', id: '1' }),
      makeNode({ type: 'decision', name: 'Use TypeScript', id: '3' }),
      makeNode({ type: 'entity', name: 'main.ts', id: '2' }),
    ];

    const serialisedA = JSON.stringify(deterministicSort(setA, compareNodes));
    const serialisedB = JSON.stringify(deterministicSort(setB, compareNodes));
    expect(serialisedA).toBe(serialisedB);
  });

  it('produces identical JSON output for the same set of relationships regardless of input order', () => {
    const makeRel = (overrides: Partial<Relationship>): Relationship => ({
      id: 'id',
      type: 'depends_on',
      fromId: 'a',
      toId: 'b',
      properties: {},
      createdAt: new Date('2024-01-01'),
      ...overrides,
    });

    const setA = [
      makeRel({ type: 'depends_on', fromId: 'a', toId: 'b', id: '1' }),
      makeRel({ type: 'active_context', fromId: 'c', toId: 'd', id: '2' }),
      makeRel({ type: 'has_decision', fromId: 'e', toId: 'f', id: '3' }),
    ];

    const setB = [
      makeRel({ type: 'has_decision', fromId: 'e', toId: 'f', id: '3' }),
      makeRel({ type: 'depends_on', fromId: 'a', toId: 'b', id: '1' }),
      makeRel({ type: 'active_context', fromId: 'c', toId: 'd', id: '2' }),
    ];

    const serialisedA = JSON.stringify(deterministicSort(setA, compareRelationships));
    const serialisedB = JSON.stringify(deterministicSort(setB, compareRelationships));
    expect(serialisedA).toBe(serialisedB);
  });

  it('produces identical prompt text for the same set of diagnostics regardless of input order', () => {
    interface Diagnostic {
      file: string;
      line: number;
      severity: string;
      message: string;
    }

    const diagnostics: Diagnostic[] = [
      { file: '/src/main.ts', line: 42, severity: 'error', message: 'Type not found' },
      { file: '/src/utils.ts', line: 10, severity: 'warning', message: 'Unused variable' },
      { file: '/src/app.ts', line: 5, severity: 'error', message: 'Missing import' },
    ];

    const shuffled = [
      diagnostics[2],
      diagnostics[0],
      diagnostics[1],
    ];

    const formatPrompt = (diags: Diagnostic[]): string => {
      const sorted = deterministicSort(diags, compareByKey((d) => d.file));
      return sorted.map((d) => `[${d.severity}] ${d.file}:${d.line} — ${d.message}`).join('\n');
    };

    expect(formatPrompt(diagnostics)).toBe(formatPrompt(shuffled));
  });
});
