/**
 * Memory Layer Skeleton Implementations
 *
 * These are placeholder implementations that implement the interfaces from
 * src/core/interfaces/memory.ts.  They will be filled in with real logic as
 * the implementation progresses.
 *
 * For now, the existing MemoryGraph (SparrowDB-backed) at ./MemoryGraph.ts
 * remains the primary working implementation.
 */

import {
  IGraphDatabase,
  IVectorIndex,
  IEmbedder,
  IMemoryGraph,
  Node,
  NodeInput,
  NodeFilter,
  Relationship,
  RelationshipInput,
  TraversalOptions,
  TraversalResult,
  Embedding,
  EmbedOptions,
  VectorInput,
  VectorEntry,
  SearchQuery,
  SearchResult,
  RebuildOptions,
  ProjectSnapshot,
  SearchOptions,
  ContextSearchResult,
  MemoryMetadata,
  MemoryEntry,
  NodeNotFoundError,
  RelationshipNotFoundError,
  ValidationError,
  DuplicateNodeError,
  DimensionMismatchError,
  VectorNotFoundError,
} from '../core/interfaces/memory';

// ============================================================================
// SKELETON 1: GraphDatabase
// ============================================================================

/**
 * In-memory graph database implementing IGraphDatabase.
 * Uses Maps for storage and maintains indexes for fast lookups.
 */
export class GraphDatabase implements IGraphDatabase {
  private nodes: Map<string, Node> = new Map();
  private relationships: Map<string, Relationship> = new Map();

  // Indexes
  private byType: Map<string, Set<string>> = new Map();       // type → node ids
  private byName: Map<string, string> = new Map();             // name → node id (first match)
  private byStatus: Map<string, Set<string>> = new Map();       // status → node ids
  private outgoingRelationships: Map<string, string[]> = new Map(); // nodeId → rel ids
  private incomingRelationships: Map<string, string[]> = new Map(); // nodeId → rel ids

  // Mutation callbacks
  private mutateCallbacks: Set<() => void> = new Set();

  onDidMutate(callback: () => void): { dispose: () => void } {
    this.mutateCallbacks.add(callback);
    return {
      dispose: () => { this.mutateCallbacks.delete(callback); },
    };
  }

  private _notifyMutate(): void {
    for (const cb of this.mutateCallbacks) {
      try { cb(); } catch { /* swallow */ }
    }
  }

  async createNode(node: NodeInput): Promise<Node> {
    this._validateNodeInput(node);

    // Check for duplicates
    const existingId = this.byName.get(node.name);
    if (existingId) {
      const existing = this.nodes.get(existingId);
      if (existing && existing.type === node.type) {
        throw new DuplicateNodeError(node.name, node.type);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const newNode: Node = {
      id,
      type: node.type,
      subtype: node.subtype,
      name: node.name,
      description: node.description,
      properties: node.properties ?? {},
      embeddingId: node.embeddingId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.nodes.set(id, newNode);
    this._indexNode(newNode);

    this._notifyMutate();
    return newNode;
  }

  async getNode(id: string): Promise<Node | null> {
    return this.nodes.get(id) ?? null;
  }

  async updateNode(id: string, updates: Partial<Node>): Promise<Node> {
    const existing = this.nodes.get(id);
    if (!existing) {
      throw new NodeNotFoundError(id);
    }

    const updated = {
      ...existing,
      ...updates,
      id: existing.id,        // immutable
      createdAt: existing.createdAt, // immutable
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    this.nodes.set(id, updated);
    this._reindexNode(existing, updated);

    this._notifyMutate();
    return updated;
  }

  async deleteNode(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) {
      throw new NodeNotFoundError(id);
    }

    // Delete all related relationships
    const outgoing = this.outgoingRelationships.get(id) ?? [];
    const incoming = this.incomingRelationships.get(id) ?? [];
    for (const relId of [...outgoing, ...incoming]) {
      this.relationships.delete(relId);
    }

    // Remove from indexes
    this.byType.get(node.type)?.delete(id);
    if (this.byName.get(node.name) === id) this.byName.delete(node.name);
    if (node.properties?.status) {
      this.byStatus.get(String(node.properties.status))?.delete(id);
    }
    this.outgoingRelationships.delete(id);
    this.incomingRelationships.delete(id);

    this.nodes.delete(id);
    this._notifyMutate();
  }

  async queryNodes(filter: NodeFilter): Promise<Node[]> {
    let ids: Set<string> | null = null;

    if (filter.type && this.byType.has(filter.type)) {
      ids = new Set(this.byType.get(filter.type)!);
    }

    if (filter.name && ids !== null) {
      const nameId = this.byName.get(filter.name);
      ids = new Set([...ids].filter((id) => id === nameId));
    } else if (filter.name) {
      const nameId = this.byName.get(filter.name);
      ids = nameId ? new Set([nameId]) : new Set();
    }

    if (filter.status && ids !== null) {
      const statusIds = this.byStatus.get(filter.status) ?? new Set();
      ids = new Set([...ids].filter((id) => statusIds.has(id)));
    } else if (filter.status) {
      ids = new Set(this.byStatus.get(filter.status) ?? new Set());
    }

    let results: Node[];
    if (ids === null) {
      results = Array.from(this.nodes.values());
    } else {
      results = Array.from(ids)
        .map((id) => this.nodes.get(id))
        .filter((n): n is Node => n !== undefined);
    }

    // Apply offset and limit
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return results;
  }

  async restoreNode(node: Node): Promise<void> {
    if (this.nodes.has(node.id)) {
      throw new NodeNotFoundError(`Node with ID ${node.id} already exists`);
    }
    this.nodes.set(node.id, node);
    this._indexNode(node);
    this._notifyMutate();
  }

  async clearAll(): Promise<void> {
    this.nodes.clear();
    this.relationships.clear();
    this.byType.clear();
    this.byName.clear();
    this.byStatus.clear();
    this.outgoingRelationships.clear();
    this.incomingRelationships.clear();
    this._notifyMutate();
  }

  async createRelationship(rel: RelationshipInput): Promise<Relationship> {
    if (rel.fromId === rel.toId) {
      throw new ValidationError('Cannot create a self-referencing relationship');
    }

    if (!this.nodes.has(rel.fromId)) {
      throw new NodeNotFoundError(rel.fromId);
    }
    if (!this.nodes.has(rel.toId)) {
      throw new NodeNotFoundError(rel.toId);
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const newRel: Relationship = {
      id,
      type: rel.type,
      fromId: rel.fromId,
      toId: rel.toId,
      properties: rel.properties ?? {},
      createdAt: now,
      weight: rel.weight,
    };

    this.relationships.set(id, newRel);

    // Index
    const outgoing = this.outgoingRelationships.get(rel.fromId) ?? [];
    outgoing.push(id);
    this.outgoingRelationships.set(rel.fromId, outgoing);

    const incoming = this.incomingRelationships.get(rel.toId) ?? [];
    incoming.push(id);
    this.incomingRelationships.set(rel.toId, incoming);

    this._notifyMutate();
    return newRel;
  }

  async getRelationships(nodeId: string): Promise<Relationship[]> {
    if (!this.nodes.has(nodeId)) {
      throw new NodeNotFoundError(nodeId);
    }

    const outgoing = (this.outgoingRelationships.get(nodeId) ?? [])
      .map((rid) => this.relationships.get(rid))
      .filter((r): r is Relationship => r !== undefined);
    const incoming = (this.incomingRelationships.get(nodeId) ?? [])
      .map((rid) => this.relationships.get(rid))
      .filter((r): r is Relationship => r !== undefined);

    return [...outgoing, ...incoming];
  }

  async deleteRelationship(id: string): Promise<void> {
    const rel = this.relationships.get(id);
    if (!rel) {
      throw new RelationshipNotFoundError(id);
    }

    // Remove from indexes
    const outgoing = this.outgoingRelationships.get(rel.fromId) ?? [];
    this.outgoingRelationships.set(rel.fromId, outgoing.filter((rid) => rid !== id));

    const incoming = this.incomingRelationships.get(rel.toId) ?? [];
    this.incomingRelationships.set(rel.toId, incoming.filter((rid) => rid !== id));

    this.relationships.delete(id);
    this._notifyMutate();
  }

  async traverse(startNodeId: string, options: TraversalOptions): Promise<TraversalResult> {
    const startNode = this.nodes.get(startNodeId);
    if (!startNode) {
      throw new NodeNotFoundError(startNodeId);
    }

    const visitedNodes = new Set<string>([startNodeId]);
    const visitedRels = new Set<string>();
    const paths: TraversalResult['paths'] = [] as TraversalResult['paths'];
    paths.push({ nodes: [startNode], relationships: [] as Relationship[] });
    let frontier = new Set<string>([startNodeId]);
    const maxNodes = options.maxNodes ?? 100;

    for (let depth = 1; depth <= options.maxDepth; depth++) {
      const nextFrontier = new Set<string>();
      const newPaths: TraversalResult['paths'] = [];

      for (const currentId of frontier) {
        const rels = await this.getRelationships(currentId);

        for (const rel of rels) {
          if (options.relationshipTypes && !options.relationshipTypes.includes(rel.type)) continue;

          // Determine direction
          const isOutgoing = rel.fromId === currentId;
          const isIncoming = rel.toId === currentId;
          if (options.direction === 'out' && !isOutgoing) continue;
          if (options.direction === 'in' && !isIncoming) continue;

          const neighborId = isOutgoing ? rel.toId : rel.fromId;

          if (!visitedNodes.has(neighborId) && visitedNodes.size < maxNodes) {
            visitedNodes.add(neighborId);
            visitedRels.add(rel.id);
            nextFrontier.add(neighborId);

            // Build paths for this branch
            const neighbor = this.nodes.get(neighborId);
            if (neighbor) {
              for (const existingPath of paths) {
                if (existingPath.nodes[existingPath.nodes.length - 1]?.id === currentId) {
                  newPaths.push({
                    nodes: [...existingPath.nodes, neighbor],
                    relationships: [...existingPath.relationships, rel],
                  });
                }
              }
            }
          }
        }
      }

      paths.push(...newPaths);
      frontier = nextFrontier;
    }

    const resultNodes = Array.from(visitedNodes)
      .map((id) => this.nodes.get(id))
      .filter((n): n is Node => n !== undefined);

    const resultRels = Array.from(visitedRels)
      .map((id) => this.relationships.get(id))
      .filter((r): r is Relationship => r !== undefined);

    // Clean up paths to only include unique ones
    const uniquePaths = this._deduplicatePaths(paths).slice(0, 10);

    return {
      nodes: resultNodes,
      relationships: resultRels,
      paths: uniquePaths,
    };
  }

  // --- Private helpers ---

  private _validateNodeInput(node: NodeInput): void {
    if (!node.name || node.name.trim().length === 0) {
      throw new ValidationError('Node name is required');
    }
    if (!node.type) {
      throw new ValidationError('Node type is required');
    }
  }

  private _indexNode(node: Node): void {
    // By type
    if (!this.byType.has(node.type)) this.byType.set(node.type, new Set());
    this.byType.get(node.type)!.add(node.id);

    // By name (first wins)
    if (!this.byName.has(node.name)) this.byName.set(node.name, node.id);

    // By status
    if (node.properties?.status) {
      const status = String(node.properties.status);
      if (!this.byStatus.has(status)) this.byStatus.set(status, new Set());
      this.byStatus.get(status)!.add(node.id);
    }
  }

  private _reindexNode(oldNode: Node, newNode: Node): void {
    // Remove old indexes
    this.byType.get(oldNode.type)?.delete(oldNode.id);
    if (this.byName.get(oldNode.name) === oldNode.id) this.byName.delete(oldNode.name);
    if (oldNode.properties?.status) {
      this.byStatus.get(String(oldNode.properties.status))?.delete(oldNode.id);
    }

    this._indexNode(newNode);
  }

  private _deduplicatePaths(paths: TraversalResult['paths']): TraversalResult['paths'] {
    const seen = new Set<string>();
    return paths.filter((path) => {
      const key = path.nodes.map((n) => n.id).join('->');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// ============================================================================
// SKELETON 2: Embedder
// ============================================================================

/**
 * Embedder that generates embeddings using all-MiniLM-L6-v2 via @xenova/transformers.
 * Implements IEmbedder with caching support.
 */
export class Embedder implements IEmbedder {
  private model: any = null;
  private pipeline: any = null;
  private cache: Map<string, { embedding: number[]; timestamp: number }> = new Map();
  private readonly CACHE_SIZE_LIMIT = 1000;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly DIMS = 384;
  private loaded = false;

  async loadModel(): Promise<void> {
    if (this.loaded) return;
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = pipeline;
      this.model = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', {
        quantized: true,
      });
      this.loaded = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new (await import('../core/interfaces/memory')).ModelLoadError(message);
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

  async embed(text: string, options?: EmbedOptions): Promise<Embedding> {
    if (!text || text.trim().length === 0) {
      throw new (await import('../core/interfaces/memory')).InvalidTextError('Text must not be empty');
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

      // Update cache
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
      throw new (await import('../core/interfaces/memory')).EmbeddingGenerationError(message);
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

// ============================================================================
// SKELETON 3: VectorIndex
// ============================================================================

/**
 * In-memory vector index using brute-force cosine similarity search.
 * Implements IVectorIndex.
 */
export class VectorIndex implements IVectorIndex {
  private vectors: Map<string, Float32Array> = new Map();
  private metadata: Map<string, import('../core/interfaces/memory').VectorMetadata> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map(); // nodeType → vector ids
  private readonly DIMS = 384;

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

  // --- Private helpers ---

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

// ============================================================================
// SKELETON 4: MemoryGraph (New IMemoryGraph implementation)
// ============================================================================

/**
 * MemoryGraph implementing IMemoryGraph.
 *
 * Coordinates operations across GraphDatabase, VectorIndex, and Embedder.
 * This is a NEW implementation that follows the graph-native interfaces.
 * The existing SparrowDB-backed MemoryGraph remains the primary working impl.
 */
export class MemoryGraphV2 implements IMemoryGraph {
  private graph: IGraphDatabase;
  private vectors: IVectorIndex;
  private embedder: IEmbedder;

  constructor(graph: IGraphDatabase, vectors: IVectorIndex, embedder: IEmbedder) {
    this.graph = graph;
    this.vectors = vectors;
    this.embedder = embedder;
  }

  // ============================================================================
  // Graph Delegation Methods
  // ============================================================================

  async getNode(id: string): Promise<Node | null> {
    return this.graph.getNode(id);
  }

  async queryNodes(filter: NodeFilter): Promise<Node[]> {
    return this.graph.queryNodes(filter);
  }

  async createRelationship(rel: RelationshipInput): Promise<Relationship> {
    return this.graph.createRelationship(rel);
  }

  async getRelationships(nodeId: string): Promise<Relationship[]> {
    return this.graph.getRelationships(nodeId);
  }

  async deleteRelationship(id: string): Promise<void> {
    return this.graph.deleteRelationship(id);
  }

  async traverse(startNodeId: string, options: TraversalOptions): Promise<TraversalResult> {
    return this.graph.traverse(startNodeId, options);
  }

  async storeNode(node: NodeInput): Promise<Node> {
    // Create node in graph
    const created = await this.graph.createNode(node);

    try {
      // Generate embedding from description (if available)
      if (node.description) {
        const embedding = await this.embedder.embed(node.description);
        const vectorEntry = await this.vectors.insert({
          nodeId: created.id,
          vector: embedding.vector,
          metadata: {
            nodeId: created.id,
            nodeType: node.type,
            nodeName: node.name,
            nodeDescription: node.description,
            embeddingVersion: 'all-MiniLM-L6-v2',
            generatedAt: new Date(),
            textHash: embedding.textHash,
            tokenCount: embedding.tokenCount,
          },
        });

        // Update node with embedding reference
        return this.graph.updateNode(created.id, { embeddingId: vectorEntry.id });
      }
    } catch {
      // Rollback: delete the node if embedding failed
      await this.graph.deleteNode(created.id);
      throw new Error('Failed to generate embedding for node, rollback complete');
    }

    return created;
  }

  async updateNode(id: string, updates: Partial<Node>): Promise<Node> {
    const existing = await this.graph.getNode(id);
    if (!existing) throw new NodeNotFoundError(id);

    // If description changed, regenerate embedding
    if (updates.description && updates.description !== existing.description) {
      const embedding = await this.embedder.embed(updates.description);

      if (existing.embeddingId) {
        await this.vectors.update(existing.embeddingId, embedding.vector);
      } else {
        const vectorEntry = await this.vectors.insert({
          nodeId: id,
          vector: embedding.vector,
          metadata: {
            nodeId: id,
            nodeType: updates.type ?? existing.type,
            nodeName: updates.name ?? existing.name,
            nodeDescription: updates.description,
            embeddingVersion: 'all-MiniLM-L6-v2',
            generatedAt: new Date(),
            textHash: embedding.textHash,
            tokenCount: embedding.tokenCount,
          },
        });
        updates.embeddingId = vectorEntry.id;
      }
    }

    return this.graph.updateNode(id, updates);
  }

  async deleteNode(id: string): Promise<void> {
    const existing = await this.graph.getNode(id);
    if (!existing) throw new NodeNotFoundError(id);

    // Delete vector index entry if exists
    if (existing.embeddingId) {
      try {
        await this.vectors.delete(existing.embeddingId);
      } catch {
        // Ignore if vector not found
      }
    }

    await this.graph.deleteNode(id);
  }

  async getProjectContext(): Promise<ProjectSnapshot> {
    const project = (await this.graph.queryNodes({ type: 'project', limit: 1 }))[0];
    if (!project) {
      // Return empty snapshot if no project exists
      return {
        project: {
          id: '',
          type: 'project',
          name: 'Unknown Project',
          properties: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 0,
        },
        activeContext: null,
        milestones: [],
        blockers: [],
        recentDecisions: [],
        recentEntities: [],
        standards: [],
        stats: {
          totalNodes: 0,
          totalRelationships: 0,
          lastUpdated: new Date(),
        },
      };
    }

    const [activeContext, milestones, blockers, decisions, entities, standards] = await Promise.all([
      this.graph.queryNodes({ type: 'activeContext', limit: 1 }).then((n) => n[0] ?? null),
      this.graph.queryNodes({ type: 'milestone' }),
      this.graph.queryNodes({ type: 'blocker' }),
      this.graph.queryNodes({ type: 'decision', limit: 5 }),
      this.graph.queryNodes({ type: 'entity', limit: 10 }),
      this.graph.queryNodes({ type: 'standard' }),
    ]);

    const allNodes = await this.graph.queryNodes({});
    const totalNodes = allNodes.length;

    return {
      project,
      activeContext,
      milestones,
      blockers,
      recentDecisions: decisions,
      recentEntities: entities,
      standards,
      stats: {
        totalNodes,
        totalRelationships: 0,
        lastUpdated: new Date(),
      },
    };
  }

  async searchContext(query: string, options?: SearchOptions): Promise<ContextSearchResult> {
    const startTime = Date.now();
    const topK = options?.topK ?? 10;
    const threshold = options?.threshold ?? 0.6;
    const includeStructural = options?.includeStructural ?? true;

    // Embed the query
    const embedding = await this.embedder.embed(query);

    // Search vector index
    const searchResults = await this.vectors.search({
      vector: embedding.vector,
      topK,
      threshold,
      filter: options?.nodeTypes ? { nodeTypes: options.nodeTypes } : undefined,
    });

    // Build result nodes
    const resultNodes: ContextSearchResult['nodes'] = [];
    const resultRels: Relationship[] = [];

    for (const sr of searchResults) {
      const node = await this.graph.getNode(sr.nodeId);
      if (node) {
        resultNodes.push({
          node,
          similarity: sr.similarity,
          source: 'semantic',
          score: sr.similarity,
        });

        // Optionally expand with structural traversal
        if (includeStructural) {
          try {
            const traversal = await this.graph.traverse(sr.nodeId, {
              maxDepth: options?.maxDepth ? (options.maxDepth as 1 | 2 | 3) : 2,
              maxNodes: 20,
            });
            resultRels.push(...traversal.relationships);

            // Add traversed nodes (at lower score)
            for (const tNode of traversal.nodes) {
              if (tNode.id !== sr.nodeId && !resultNodes.find((n) => n.node.id === tNode.id)) {
                resultNodes.push({
                  node: tNode,
                  similarity: sr.similarity * 0.5, // Discounted score
                  source: 'structural',
                  score: sr.similarity * 0.5,
                });
              }
            }
          } catch {
            // Ignore traversal errors for individual nodes
          }
        }
      }
    }

    const endTime = Date.now();

    return {
      nodes: resultNodes.slice(0, topK),
      relationships: resultRels,
      totalResults: resultNodes.length,
      searchTime: endTime - startTime,
      truncated: resultNodes.length > topK,
    };
  }

  async addMemory(text: string, metadata?: MemoryMetadata): Promise<MemoryEntry> {
    // Embed the text
    const embedding = await this.embedder.embed(text);

    // Insert into vector index
    const vectorEntry = await this.vectors.insert({
      nodeId: '', // No graph node for standalone memory entries
      vector: embedding.vector,
      metadata: {
        nodeId: '',
        nodeType: metadata?.type ?? 'conversation',
        nodeName: text.substring(0, 50),
        nodeDescription: text,
        embeddingVersion: 'all-MiniLM-L6-v2',
        generatedAt: new Date(),
        textHash: embedding.textHash,
        tokenCount: embedding.tokenCount,
      },
    });

    return {
      id: vectorEntry.id,
      text,
      embeddingId: vectorEntry.id,
      metadata: metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async recall(query: string, limit?: number): Promise<MemoryEntry[]> {
    const embedding = await this.embedder.embed(query);
    const searchResults = await this.vectors.search({
      vector: embedding.vector,
      topK: limit ?? 5,
      threshold: 0.3, // Lower threshold for memory recall
    });

    return searchResults.map((sr) => ({
      id: sr.vectorId,
      text: sr.metadata.nodeDescription ?? sr.metadata.nodeName,
      embeddingId: sr.vectorId,
      metadata: {
        type: sr.metadata.nodeType,
      },
      nodeId: sr.metadata.nodeId || undefined,
      createdAt: new Date(sr.metadata.generatedAt),
      updatedAt: new Date(sr.metadata.generatedAt),
    }));
  }

  async sync(): Promise<void> {
    // Check consistency between graph and vector index
    await this.vectors.rebuild();
  }
}
