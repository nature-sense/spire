/**
 * In-memory graph database implementing IGraphDatabase.
 *
 * Uses Maps for storage and maintains indexes for fast lookups by type,
 * name, and status.  Relationships are indexed by both source and target
 * node ID so traversal can go in either direction.
 *
 * This is the *first* of four memory-layer components:
 *   1. GraphDatabase   – stores nodes and relationships (this file)
 *   2. Embedder        – generates 384-dim vectors via all-MiniLM-L6-v2
 *   3. VectorIndex     – brute-force cosine-similarity search over vectors
 *   4. MemoryGraph     – facade that coordinates the other three
 */

import { injectable } from 'inversify';
import {
  IGraphDatabase,
  Node,
  NodeInput,
  NodeFilter,
  Relationship,
  RelationshipInput,
  TraversalOptions,
  TraversalResult,
  NodeNotFoundError,
  RelationshipNotFoundError,
  ValidationError,
  DuplicateNodeError,
} from '../core/interfaces/memory';

@injectable()
export class GraphDatabase implements IGraphDatabase {
  private nodes: Map<string, Node> = new Map();
  private relationships: Map<string, Relationship> = new Map();

  // Indexes
  private byType: Map<string, Set<string>> = new Map();        // type → node ids
  private byName: Map<string, string> = new Map();              // name → node id (first match)
  private byStatus: Map<string, Set<string>> = new Map();        // status → node ids
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

  // -----------------------------------------------------------------------
  // Node Operations
  // -----------------------------------------------------------------------

  async createNode(node: NodeInput): Promise<Node> {
    this._validateNodeInput(node);

    // Check for duplicates (same name + type)
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
      id: existing.id,          // immutable
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

  // -----------------------------------------------------------------------
  // Relationship Operations
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Graph Traversal
  // -----------------------------------------------------------------------

  async traverse(startNodeId: string, options: TraversalOptions): Promise<TraversalResult> {
    const startNode = this.nodes.get(startNodeId);
    if (!startNode) {
      throw new NodeNotFoundError(startNodeId);
    }

    const visitedNodes = new Set<string>([startNodeId]);
    const visitedRels = new Set<string>();
    const paths: Array<{ nodes: Node[]; relationships: Relationship[] }> = [];
    paths.push({ nodes: [startNode], relationships: [] });
    let frontier = new Set<string>([startNodeId]);
    const maxNodes = options.maxNodes ?? 100;

    for (let depth = 1; depth <= options.maxDepth; depth++) {
      const nextFrontier = new Set<string>();
      const newPaths: Array<{ nodes: Node[]; relationships: Relationship[] }> = [];

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

    const uniquePaths = this._deduplicatePaths(paths as TraversalResult['paths']).slice(0, 10);

    return {
      nodes: resultNodes,
      relationships: resultRels,
      paths: uniquePaths,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

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
