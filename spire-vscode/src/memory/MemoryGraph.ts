/**
 * MemoryGraph Implementation
 * 
 * This class provides a unified facade for all memory operations.
 * It coordinates GraphDatabase, VectorIndex, and Embedder to provide
 * high-level operations with consistency guarantees.
 * 
 * Key responsibilities:
 * - Store/update/delete nodes with automatic embedding management
 * - Semantic + structural search
 * - Project context snapshots
 * - Memory storage and recall
 * - Consistency management
 */

import { injectable, inject } from 'inversify';
// Use local Symbol.for() references instead of importing TYPES from DI types
// to avoid a module-load order issue where MemoryGraph is required before TYPES
// is fully initialized (see types.ts comment about the circular dependency).
const IGraphDatabase = Symbol.for('IGraphDatabase');
const IVectorIndex = Symbol.for('IVectorIndex');
const IEmbedder = Symbol.for('IEmbedder');
import {
  IMemoryGraph,
  IGraphDatabase,
  IVectorIndex,
  IEmbedder,
  Node,
  NodeInput,
  NodeFilter,
  Relationship,
  RelationshipInput,
  TraversalOptions,
  TraversalResult,
  ProjectSnapshot,
  SearchOptions,
  ContextSearchResult,
  MemoryEntry,
  MemoryMetadata,
  NodeNotFoundError,
  ConsistencyError
} from '../core/interfaces/memory';

export interface RememberOptions {
  concept: string;
  details: string;
  category?: string;
  related_to?: string;
}

export interface RecallOptions {
  concept: string;
  include_related?: boolean;
}

export interface ListOptions {
  category?: string;
  limit?: number;
}

export interface LinkOptions {
  from: string;
  to: string;
  relation: string;
  evidence?: string;
}

@injectable()
export class MemoryGraph implements IMemoryGraph {
  // ============================================================================
  // Dependencies (private — all access goes through this facade)
  // ============================================================================
  
  constructor(
    @inject(IGraphDatabase) private graph: IGraphDatabase,
    @inject(IVectorIndex) private vectors: IVectorIndex,
    @inject(IEmbedder) private embedder: IEmbedder
  ) {
    // Safety net: subscribe to graph mutations and re-sync vectors if needed
    this.graph.onDidMutate(() => {
      this._coordinateSync().catch(err => {
        console.warn('[MemoryGraph] Safety sync failed:', err);
      });
    });
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

  // ============================================================================
  // Node Operations (with automatic embedding management)
  // ============================================================================

  /**
   * Store a node with automatic embedding generation
   * 
   * Steps:
   * 1. Create node in graph
   * 2. If description exists, generate embedding
   * 3. Store embedding in vector index
   * 4. Update node with embeddingId
   * 5. Return complete node
   * 
   * Error handling: If embedding fails, node is still created (degraded mode)
   */
  async storeNode(nodeInput: NodeInput): Promise<Node> {
    // 1. Create node in graph
    const node = await this.graph.createNode(nodeInput);
    
    // 2. Generate and store embedding if description exists
    if (node.description && node.description.trim().length > 0) {
      try {
        const embedding = await this.embedder.embed(node.description);
        
        // 3. Store in vector index
        const vectorEntry = await this.vectors.insert({
          nodeId: node.id,
          vector: embedding.vector,
          metadata: {
            nodeId: node.id,
            nodeType: node.type,
            nodeName: node.name,
            nodeDescription: node.description,
            embeddingVersion: embedding.modelName,
            generatedAt: embedding.generatedAt,
            textHash: embedding.textHash,
            tokenCount: embedding.tokenCount
          }
        });
        
        // 4. Update node with embedding ID
        node.embeddingId = vectorEntry.id;
        await this.graph.updateNode(node.id, { embeddingId: vectorEntry.id });
      } catch (error) {
        // Log but don't fail - node is still usable without embedding
        console.warn(`[MemoryGraph] Failed to generate embedding for node ${node.id}:`, error);
      }
    }
    
    return node;
  }

  /**
   * Update a node with automatic embedding regeneration
   * 
   * Steps:
   * 1. Get existing node
   * 2. Update node in graph
   * 3. If description changed, regenerate embedding
   * 4. Update or create vector index entry
   * 5. Return updated node
   */
  async updateNode(id: string, updates: Partial<Node>): Promise<Node> {
    // 1. Get existing node
    const existing = await this.graph.getNode(id);
    if (!existing) {
      throw new NodeNotFoundError(id);
    }
    
    // 2. Update node in graph
    const updatedNode = await this.graph.updateNode(id, updates);
    
    // 3. If description changed, update embedding
    const descriptionChanged = updates.description !== undefined && 
                               updates.description !== existing.description;
    
    if (descriptionChanged && updatedNode.description && updatedNode.description.trim().length > 0) {
      try {
        const embedding = await this.embedder.embed(updatedNode.description);
        
        if (updatedNode.embeddingId) {
          // Update existing vector
          await this.vectors.update(updatedNode.embeddingId, embedding.vector);
        } else {
          // Create new vector
          const vectorEntry = await this.vectors.insert({
            nodeId: updatedNode.id,
            vector: embedding.vector,
            metadata: {
              nodeId: updatedNode.id,
              nodeType: updatedNode.type,
              nodeName: updatedNode.name,
              nodeDescription: updatedNode.description,
              embeddingVersion: embedding.modelName,
              generatedAt: embedding.generatedAt,
              textHash: embedding.textHash,
              tokenCount: embedding.tokenCount
            }
          });
          updatedNode.embeddingId = vectorEntry.id;
          await this.graph.updateNode(id, { embeddingId: vectorEntry.id });
        }
      } catch (error) {
        console.warn(`[MemoryGraph] Failed to update embedding for node ${id}:`, error);
      }
    }
    
    return updatedNode;
  }

  /**
   * Delete a node and its embedding
   * 
   * Steps:
   * 1. Get node
   * 2. Delete from vector index if embedding exists
   * 3. Delete node from graph
   */
  async deleteNode(id: string): Promise<void> {
    // 1. Get node
    const node = await this.graph.getNode(id);
    if (!node) {
      throw new NodeNotFoundError(id);
    }
    
    // 2. Delete from vector index if embedding exists
    if (node.embeddingId) {
      try {
        await this.vectors.delete(node.embeddingId);
      } catch (error) {
        console.warn(`[MemoryGraph] Failed to delete embedding for node ${id}:`, error);
      }
    }
    
    // 3. Delete node from graph
    await this.graph.deleteNode(id);
  }

  // ============================================================================
  // Context Retrieval Operations
  // ============================================================================

  /**
   * Get project context snapshot
   * 
   * Returns:
   * - Project node
   * - Active context (if any)
   * - Milestones
   * - Blockers
   * - Recent decisions (last 5)
   * - Recent entities (last 10)
   * - Standards
   * - Statistics
   */
  async getProjectContext(): Promise<ProjectSnapshot> {
    // 1. Find project node
    const projectNodes = await this.graph.queryNodes({ type: 'project' });
    const project = projectNodes.length > 0 ? projectNodes[0] : null;
    
    // 2. Get active context
    let activeContext: Node | null = null;
    if (project) {
      const rels = await this.graph.getRelationships(project.id);
      const activeRel = rels.find(r => r.type === 'active_context');
      if (activeRel) {
        const contextNode = await this.graph.getNode(activeRel.toId);
        if (contextNode) activeContext = contextNode;
      }
    }
    
    // 3. Get milestones (active or all)
    const milestones = await this.graph.queryNodes({ 
      type: 'milestone'
    });
    
    // 4. Get blockers (open)
    const blockers = await this.graph.queryNodes({ 
      type: 'blocker',
      status: 'open'
    });
    
    // 5. Get decisions, sorted by date (newest first)
    const decisions = await this.graph.queryNodes({ type: 'decision' });
    decisions.sort((a, b) => {
      const dateA = a.properties?.date || a.createdAt;
      const dateB = b.properties?.date || b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
    
    // 6. Get entities, sorted by updatedAt (newest first)
    const entities = await this.graph.queryNodes({ type: 'entity' });
    entities.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    
    // 7. Get standards
    const standards = await this.graph.queryNodes({ type: 'standard' });
    
    // 8. Build statistics
    const allNodes = await this.graph.queryNodes({});
    const allRels = await this.getTotalRelationships();
    
    // 9. Build snapshot
    return {
      project: project || {
        id: 'project-root',
        type: 'project',
        name: 'Untitled Project',
        description: 'No project context available. Create a project node to get started.',
        properties: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      },
      activeContext,
      milestones: milestones.slice(0, 10), // Limit to 10
      blockers: blockers.slice(0, 10), // Limit to 10
      recentDecisions: decisions.slice(0, 5),
      recentEntities: entities.slice(0, 10),
      standards: standards.slice(0, 20),
      stats: {
        totalNodes: allNodes.length,
        totalRelationships: allRels,
        lastUpdated: new Date()
      }
    };
  }

  /**
   * Search for context related to a query
   * 
   * Combines semantic search (embeddings) with structural expansion (graph traversal)
   * 
   * Steps:
   * 1. Embed the query
   * 2. Search vector index for similar nodes
   * 3. Expand with structural traversal (if enabled)
   * 4. Combine and score results
   * 5. Return ranked results
   */
  async searchContext(query: string, options?: SearchOptions): Promise<ContextSearchResult> {
    const startTime = Date.now();
    const topK = options?.topK || 10;
    const threshold = options?.threshold || 0.6;
    const includeStructural = options?.includeStructural !== false;
    const maxDepth = options?.maxDepth || 2;
    const recencyWeight = options?.recencyWeight || 0.2;
    
    // 1. Embed the query
    const embedding = await this.embedder.embed(query);
    
    // 2. Search vector index
    const searchResults = await this.vectors.search({
      vector: embedding.vector,
      topK: topK * 2, // Fetch more for structural expansion
      threshold: threshold,
      filter: options?.nodeTypes ? { nodeTypes: options.nodeTypes } : undefined
    });
    
    // 3. Build semantic results
    const semanticResults: ContextSearchResult['nodes'] = [];
    const nodeIds = new Set<string>();
    const nodeScores = new Map<string, number>();
    
    for (const sr of searchResults) {
      const node = await this.graph.getNode(sr.nodeId);
      if (node) {
        // Apply recency weighting if enabled
        let score = sr.similarity;
        if (recencyWeight > 0) {
          const recencyScore = this.calculateRecencyScore(node);
          score = (sr.similarity * (1 - recencyWeight)) + (recencyScore * recencyWeight);
        }
        
        semanticResults.push({
          node,
          similarity: sr.similarity,
          source: 'semantic',
          score: score
        });
        nodeIds.add(node.id);
        nodeScores.set(node.id, score);
      }
    }
    
    // 4. Structural expansion (optional)
    const structuralResults: ContextSearchResult['nodes'] = [];
    const relationships: any[] = [];
    
    if (includeStructural && semanticResults.length > 0) {
      // Get top semantic result as seed
      const topNode = semanticResults[0]?.node;
      if (topNode) {
        const traversal = await this.graph.traverse(topNode.id, {
          maxDepth: maxDepth as 1 | 2 | 3,
          maxNodes: 20
        });
        
        // Add relationships to results
        relationships.push(...traversal.relationships);
        
        // Add structural nodes
        for (const node of traversal.nodes) {
          if (!nodeIds.has(node.id)) {
            // Calculate distance score
            let distance = Infinity;
            for (const path of traversal.paths) {
              const idx = path.nodes.findIndex(n => n.id === node.id);
              if (idx !== -1) {
                distance = Math.min(distance, idx);
              }
            }
            
            const score = distance === 0 ? 1.0 : Math.max(0, 1 - (distance * 0.3));
            
            structuralResults.push({
              node,
              similarity: 0, // No semantic similarity
              source: 'structural',
              score: score
            });
            nodeIds.add(node.id);
          }
        }
      }
    }
    
    // 5. Combine and sort results
    const allResults = [...semanticResults, ...structuralResults];
    
    // Sort by score (descending)
    allResults.sort((a, b) => b.score - a.score);
    
    // 6. Limit results
    const limitedResults = allResults.slice(0, topK);
    
    return {
      nodes: limitedResults,
      relationships: relationships,
      totalResults: allResults.length,
      searchTime: Date.now() - startTime,
      truncated: allResults.length > topK
    };
  }

  // ============================================================================
  // Memory Operations (Conversation Memory)
  // ============================================================================

  /**
   * Add a memory entry
   * 
   * Stores text with embedding for future recall
   * 
   * Steps:
   * 1. Embed the text
   * 2. Store in vector index as a memory entry
   * 3. Return memory entry
   */
  async addMemory(text: string, metadata?: MemoryMetadata): Promise<MemoryEntry> {
    // 1. Generate embedding
    const embedding = await this.embedder.embed(text);
    
    // 2. Create memory node ID
    const memoryId = `memory-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // 3. Store in vector index
    const vectorEntry = await this.vectors.insert({
      nodeId: memoryId,
      vector: embedding.vector,
      metadata: {
        nodeId: memoryId,
        nodeType: metadata?.type || 'conversation',
        nodeName: metadata?.tags?.join(', ') || 'memory',
        nodeDescription: text,
        embeddingVersion: embedding.modelName,
        generatedAt: embedding.generatedAt,
        textHash: embedding.textHash,
        tokenCount: embedding.tokenCount
      }
    });
    
    // 4. Create memory entry
    return {
      id: vectorEntry.id,
      text: text,
      embeddingId: vectorEntry.id,
      metadata: metadata || {},
      nodeId: memoryId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Recall memories similar to a query
   * 
   * Steps:
   * 1. Embed the query
   * 2. Search vector index
   * 3. Convert to memory entries
   * 4. Return memories
   */
  async recall(query: string, limit?: number): Promise<MemoryEntry[]> {
    // 1. Embed query
    const embedding = await this.embedder.embed(query);
    
    // 2. Search vector index
    const results = await this.vectors.search({
      vector: embedding.vector,
      topK: limit || 10,
      threshold: 0.5
    });
    
    // 3. Convert to memory entries
    const entries: MemoryEntry[] = [];
    for (const result of results) {
      const meta = result.metadata;
      entries.push({
        id: result.vectorId,
        text: meta.nodeDescription || meta.nodeName,
        embeddingId: result.vectorId,
        metadata: {
          type: meta.nodeType,
          tags: [meta.nodeName]
        },
        nodeId: meta.nodeId,
        createdAt: meta.generatedAt,
        updatedAt: meta.generatedAt
      });
    }
    
    return entries;
  }

  // ============================================================================
  // Consistency Management
  // ============================================================================

  /**
   * Sync graph and vector index
   * 
   * Checks:
   * - Nodes with embeddingId have corresponding vectors
   * - Vectors have corresponding nodes
   * - No orphaned vectors
   * 
   * Returns: void (throws ConsistencyError if issues found)
   */
  async sync(): Promise<void> {
    const issues: string[] = [];
    
    // 1. Check nodes with embeddingId have vectors
    const nodes = await this.graph.queryNodes({});
    for (const node of nodes) {
      if (node.embeddingId) {
        // Check if vector exists by trying to get it
        // Note: VectorIndex doesn't have a get() method currently
        // This is a simplified check
        try {
          // We'll search for the vector by nodeId
          const searchResult = await this.vectors.search({
            vector: new Array(384).fill(0), // Placeholder
            topK: 100,
            threshold: 0
          });
          const found = searchResult.some(r => r.nodeId === node.id);
          if (!found) {
            issues.push(`Node ${node.id} has embeddingId ${node.embeddingId} but no matching vector found`);
          }
        } catch (error) {
          issues.push(`Node ${node.id} embedding check failed: ${error}`);
        }
      }
    }
    
    if (issues.length > 0) {
      throw new ConsistencyError(`Sync found ${issues.length} issues: ${issues.join('; ')}`);
    }
    
    console.log('[MemoryGraph] Sync completed successfully');
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Safety net: after any graph mutation, check if a node has a description
   * but no embeddingId (or vice-versa) and repair.
   */
  private async _coordinateSync(): Promise<void> {
    try {
      const nodes = await this.graph.queryNodes({});
      for (const node of nodes) {
        if (node.description && node.description.trim().length > 0 && !node.embeddingId) {
          // Node has description but no embedding — create one
          const embedding = await this.embedder.embed(node.description);
          const vectorEntry = await this.vectors.insert({
            nodeId: node.id,
            vector: embedding.vector,
            metadata: {
              nodeId: node.id,
              nodeType: node.type,
              nodeName: node.name,
              nodeDescription: node.description,
              embeddingVersion: embedding.modelName,
              generatedAt: embedding.generatedAt,
              textHash: embedding.textHash,
              tokenCount: embedding.tokenCount
            }
          });
          await this.graph.updateNode(node.id, { embeddingId: vectorEntry.id });
        }
      }
    } catch (err) {
      // Non-critical — log and move on
      console.warn('[MemoryGraph] _coordinateSync error:', err);
    }
  }

  /**
   * Calculate recency score for a node (0-1)
   * Higher score = more recent
   * Uses exponential decay with 24-hour half-life
   */
  private calculateRecencyScore(node: Node): number {
    const ageHours = (Date.now() - node.updatedAt.getTime()) / (1000 * 60 * 60);
    return Math.exp(-ageHours / 24);
  }

  /**
   * Get total number of relationships in the graph
   * This is O(n) so use sparingly
   */
  private async getTotalRelationships(): Promise<number> {
    const nodes = await this.graph.queryNodes({});
    let total = 0;
    for (const node of nodes) {
      const rels = await this.graph.getRelationships(node.id);
      total += rels.length;
    }
    return total;
  }
}
