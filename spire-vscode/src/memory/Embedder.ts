/**
 * Embedder that generates embeddings using all-MiniLM-L6-v2 via @xenova/transformers.
 *
 * Implements IEmbedder with:
 *  - Singleton model loading (lazy, first-use)
 *  - LRU cache with 1-hour TTL
 *  - Batch embedding support (configurable batch size)
 *  - Cosine similarity calculation
 *
 * This is the *second* of four memory-layer components:
 *   1. GraphDatabase   – stores nodes and relationships
 *   2. Embedder        – generates 384-dim vectors via all-MiniLM-L6-v2 (this file)
 *   3. VectorIndex     – brute-force cosine-similarity search over vectors
 *   4. MemoryGraph     – facade that coordinates the other three
 */

import { injectable } from 'inversify';
import {
  IEmbedder,
  Embedding,
  EmbedOptions,
  InvalidTextError,
  EmbeddingGenerationError,
  ModelLoadError,
  DimensionMismatchError,
} from '../core/interfaces/memory';

@injectable()
export class Embedder implements IEmbedder {
  private model: any = null;
  private pipeline: any = null;
  private cache: Map<string, { embedding: number[]; timestamp: number }> = new Map();
  private readonly CACHE_SIZE_LIMIT = 1000;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly DIMS = 384;
  private loaded = false;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async loadModel(): Promise<void> {
    if (this.loaded) return;
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = pipeline;
      this.model = await pipeline('feature-extraction', 'sentence-transformers/all-MiniLM-L6-v2', {
        quantized: true,
      });
      this.loaded = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ModelLoadError(message);
    }
  }

  async unloadModel(): Promise<void> {
    this.model = null;
    this.pipeline = null;
    this.loaded = false;
    this.cache.clear();
  }

  getDimensions(): number {
    return this.DIMS;
  }

  // -----------------------------------------------------------------------
  // Embedding Generation
  // -----------------------------------------------------------------------

  async embed(text: string, options?: EmbedOptions): Promise<Embedding> {
    if (!text || text.trim().length === 0) {
      throw new InvalidTextError('Text must not be empty');
    }

    if (!this.loaded) {
      await this.loadModel();
    }

    const hash = this._hashText(text);
    const useCache = options?.useCache !== false;

    // Check cache
    if (useCache) {
      const cached = this.cache.get(hash);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
        return {
          vector: cached.embedding,
          text,
          textHash: hash,
          tokenCount: this._estimateTokens(text),
          dimensions: this.DIMS,
          modelName: 'all-MiniLM-L6-v2',
          version: '1',
          generatedAt: new Date(cached.timestamp),
        };
      }
    }

    try {
      const output = await this.model(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data) as number[];

      // Update cache (LRU eviction)
      if (useCache) {
        if (this.cache.size >= this.CACHE_SIZE_LIMIT) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(hash, { embedding: vector, timestamp: Date.now() });
      }

      return {
        vector,
        text,
        textHash: hash,
        tokenCount: this._estimateTokens(text),
        dimensions: this.DIMS,
        modelName: 'all-MiniLM-L6-v2',
        version: '1',
        generatedAt: new Date(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new EmbeddingGenerationError(message);
    }
  }

  async embedBatch(texts: string[], options?: EmbedOptions): Promise<Embedding[]> {
    const batchSize = options?.batchSize ?? 32;
    const results: Embedding[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((text) => this.embed(text, options)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Similarity
  // -----------------------------------------------------------------------

  similarity(a: number[], b: number[]): number {
    if (a.length !== this.DIMS || b.length !== this.DIMS) {
      throw new DimensionMismatchError(this.DIMS, Math.max(a.length, b.length));
    }

    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, dot));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return String(hash);
  }

  private _estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}
