/**
 * In-memory vector index using brute-force cosine similarity search.
 *
 * Implements IVectorIndex with:
 *  - Float32Array storage for memory efficiency
 *  - L2 normalization on insert/update
 *  - Filtering by node type, status, and date range
 *  - Configurable threshold for search results
 *  - Rebuild support with progress callback
 *
 * This is the *third* of four memory-layer components:
 *   1. GraphDatabase   – stores nodes and relationships
 *   2. Embedder        – generates 384-dim vectors via all-MiniLM-L6-v2
 *   3. VectorIndex     – brute-force cosine-similarity search over vectors (this file)
 *   4. MemoryGraph     – facade that coordinates the other three
 */

import { injectable } from 'inversify';
import {
  IVectorIndex,
  VectorInput,
  VectorEntry,
  SearchQuery,
  SearchResult,
  RebuildOptions,
  DimensionMismatchError,
  VectorNotFoundError,
} from '../core/interfaces/memory';

@injectable()
export class VectorIndex implements IVectorIndex {
  private vectors: Map<string, Float32Array> = new Map();
  private metadata: Map<string, import('../core/interfaces/memory').VectorMetadata> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map(); // nodeType → vector ids
  private readonly DIMS = 384;

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  async insert(vector: VectorInput): Promise<VectorEntry> {
    if (vector.vector.length !== this.DIMS) {
      throw new DimensionMismatchError(this.DIMS, vector.vector.length);
    }

    const id = vector.id ?? crypto.randomUUID();
    const now = new Date();

    // Normalize vector
    const normalized = this._normalize(vector.vector);

    this.vectors.set(id, new Float32Array(normalized));
    this.metadata.set(id, {
      ...vector.metadata,
      generatedAt: vector.metadata.generatedAt ?? now,
    });

    // Update inverted index
    const type = vector.metadata.nodeType;
    if (!this.invertedIndex.has(type)) {
      this.invertedIndex.set(type, new Set());
    }
    this.invertedIndex.get(type)!.add(id);

    return {
      id,
      nodeId: vector.nodeId,
      vector: normalized,
      metadata: this.metadata.get(id)!,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(id: string, vector: number[]): Promise<VectorEntry> {
    if (!this.vectors.has(id)) {
      throw new VectorNotFoundError(id);
    }
    if (vector.length !== this.DIMS) {
      throw new DimensionMismatchError(this.DIMS, vector.length);
    }

    const normalized = this._normalize(vector);
    this.vectors.set(id, new Float32Array(normalized));

    const meta = this.metadata.get(id)!;
    this.metadata.set(id, { ...meta, generatedAt: new Date() });

    return {
      id,
      nodeId: meta.nodeId,
      vector: normalized,
      metadata: this.metadata.get(id)!,
      createdAt: meta.generatedAt,
      updatedAt: new Date(),
    };
  }

  async delete(id: string): Promise<void> {
    if (!this.vectors.has(id)) {
      throw new VectorNotFoundError(id);
    }

    const meta = this.metadata.get(id);
    this.vectors.delete(id);
    this.metadata.delete(id);

    // Remove from inverted index
    if (meta) {
      const typeSet = this.invertedIndex.get(meta.nodeType);
      if (typeSet) {
        typeSet.delete(id);
        if (typeSet.size === 0) this.invertedIndex.delete(meta.nodeType);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const queryVector = this._normalize(query.vector);
    const threshold = query.threshold ?? 0.6;
    const topK = query.topK;

    // Determine candidates
    let candidateIds: string[];
    if (query.filter?.nodeTypes && query.filter.nodeTypes.length > 0) {
      const ids = new Set<string>();
      for (const nodeType of query.filter.nodeTypes) {
        const typeIds = this.invertedIndex.get(nodeType);
        if (typeIds) {
          for (const id of typeIds) ids.add(id);
        }
      }
      candidateIds = Array.from(ids);
    } else {
      candidateIds = Array.from(this.vectors.keys());
    }

    // Score all candidates
    const scored: Array<{ id: string; score: number }> = [];
    for (const id of candidateIds) {
      const vec = this.vectors.get(id)!;
      const score = this._cosineSimilarity(queryVector, Array.from(vec));

      // Apply date range filter
      if (query.filter?.dateRange) {
        const meta = this.metadata.get(id);
        if (meta) {
          const genDate = new Date(meta.generatedAt);
          if (query.filter.dateRange.from && genDate < query.filter.dateRange.from) continue;
          if (query.filter.dateRange.to && genDate > query.filter.dateRange.to) continue;
        }
      }

      if (score >= threshold) {
        scored.push({ id, score });
      }
    }

    // Sort by similarity descending, take topK
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    // Build results
    return topResults.map((s) => {
      const meta = this.metadata.get(s.id)!;
      return {
        vectorId: s.id,
        nodeId: meta.nodeId,
        similarity: s.score,
        metadata: meta,
        distance: 1 - s.score,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------------------

  async rebuild(options?: RebuildOptions): Promise<void> {
    // For this simple implementation, re-normalize all vectors
    const entries = Array.from(this.vectors.entries());
    const batchSize = options?.batchSize ?? 100;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      for (const [id, vec] of batch) {
        const normalized = this._normalize(Array.from(vec));
        this.vectors.set(id, new Float32Array(normalized));
      }

      if (options?.onProgress) {
        options.onProgress(Math.min((i + batchSize) / entries.length, 1));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _normalize(vector: number[]): number[] {
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  private _cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(0, Math.min(1, dot));
  }
}
