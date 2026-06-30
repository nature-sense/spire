/**
 * Deterministic Sorting Utilities
 *
 * Provides composable comparator functions and a stable sort wrapper that
 * guarantees the same set of objects always produces the same ordered array.
 *
 * Every comparator chains primary → secondary → tertiary keys so there is
 * always a total order (no ties).  This is critical for DeepSeek V4 prompt
 * caching: identical serialised prompts produce identical cache keys.
 *
 * Usage:
 *   import { deterministicSort, compareStrings, compareByKey } from './deterministic-sort';
 *
 *   // Sort any array of objects by a string key
 *   const sorted = deterministicSort(diagnostics, compareByKey(d => d.file));
 *
 *   // Sort nodes by type → name → id
 *   const nodes = deterministicSort(rawNodes, compareNodes);
 */

// ============================================================================
// Base Comparators
// ============================================================================

/**
 * Compare two strings using localeCompare for cross-platform stability.
 * Returns -1, 0, or 1.
 */
export function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Compare two numbers.  Returns -1, 0, or 1.
 */
export function compareNumbers(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compare two Dates (chronological order).  Returns -1, 0, or 1.
 */
export function compareDates(a: Date, b: Date): number {
  return compareNumbers(a.getTime(), b.getTime());
}

/**
 * Compare two booleans (false < true).  Returns -1, 0, or 1.
 */
export function compareBooleans(a: boolean, b: boolean): number {
  return compareNumbers(a ? 1 : 0, b ? 1 : 0);
}

// ============================================================================
// Composable Helpers
// ============================================================================

/**
 * Return a new array sorted deterministically by the given comparator.
 * Does NOT mutate the original array.
 */
export function deterministicSort<T>(items: T[], cmp: (a: T, b: T) => number): T[] {
  return [...items].sort(cmp);
}

/**
 * Create a comparator that sorts by extracting a string key from each item.
 * Useful for sorting arbitrary objects that end up in a prompt.
 *
 * Example:
 *   const byFile = compareByKey((d: Diagnostic) => d.file);
 *   const sorted = deterministicSort(diagnostics, byFile);
 */
export function compareByKey<T>(keyFn: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => compareStrings(keyFn(a), keyFn(b));
}

/**
 * Create a comparator that sorts by extracting a number key from each item.
 */
export function compareByNumberKey<T>(keyFn: (x: T) => number): (a: T, b: T) => number {
  return (a, b) => compareNumbers(keyFn(a), keyFn(b));
}

/**
 * Create a comparator that sorts by extracting a Date key from each item.
 */
export function compareByDateKey<T>(keyFn: (x: T) => Date): (a: T, b: T) => number {
  return (a, b) => compareDates(keyFn(a), keyFn(b));
}

/**
 * Create a comparator that sorts by extracting a boolean key from each item.
 */
export function compareByBooleanKey<T>(keyFn: (x: T) => boolean): (a: T, b: T) => number {
  return (a, b) => compareBooleans(keyFn(a), keyFn(b));
}

/**
 * Compose multiple comparators into a single comparator.
 * Tries each comparator in order; returns the first non-zero result.
 *
 * Example:
 *   const byTypeThenName = composeComparators(
 *     compareByKey((n: Node) => n.type),
 *     compareByKey((n: Node) => n.name),
 *   );
 */
export function composeComparators<T>(...comparators: Array<(a: T, b: T) => number>): (a: T, b: T) => number {
  return (a, b) => {
    for (const cmp of comparators) {
      const result = cmp(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

// ============================================================================
// Memory-Graph Comparators
// ============================================================================

import {
  Node,
  Relationship,
} from '../core/interfaces/memory';

/**
 * Compare two Nodes: type → name → id (UUID tiebreaker).
 */
export function compareNodes(a: Node, b: Node): number {
  return (
    compareStrings(a.type, b.type) ||
    compareStrings(a.name, b.name) ||
    compareStrings(a.id, b.id)
  );
}

/**
 * Compare two Relationships: type → fromId → toId → id.
 */
export function compareRelationships(a: Relationship, b: Relationship): number {
  return (
    compareStrings(a.type, b.type) ||
    compareStrings(a.fromId, b.fromId) ||
    compareStrings(a.toId, b.toId) ||
    compareStrings(a.id, b.id)
  );
}
