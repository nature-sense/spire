/**
 * Memory Layer Interfaces
 * These define the contract for all memory-related modules
 * 
 * The memory layer is the foundation of the system. It provides:
 * 1. Graph storage (nodes + relationships)
 * 2. Embedding generation (all-MiniLM-L6-v2)
 * 3. Vector search (semantic retrieval)
 * 4. Unified facade (MemoryGraph)
 */

// ============================================================================
// TYPES
// ============================================================================

export type NodeType =
  | 'project'
  | 'entity'
  | 'decision'
  | 'activeContext'
  | 'blocker'
  | 'milestone'
  | 'standard'
  | 'conversation'
  | 'session';

export type RelationshipType =
  | 'active_context'
  | 'has_decision'
  | 'has_blocker'
  | 'has_milestone'
  | 'follows_standard'
  | 'belongs_to'
  | 'depends_on'
  | 'called_by'
  | 'resolves'
  | 'supersedes'
  | 'semantically_related'
  | 'conversation_context'
  | 'learned_from'
  | 'session_worked_on'
  | 'informed_by';

export type RetrieverType =
  | 'ambient'
  | 'semantic'
  | 'structural'
  | 'timeWeighted'
  | 'crossSession'
  | 'hybrid';

// ============================================================================
// NODE INTERFACES
// ============================================================================

export interface Node {
  id: string;                    // UUID v4
  type: NodeType;
  subtype?: string;              // Optional: 'function', 'class', 'file', etc.
  name: string;                  // Human-readable name
  description?: string;          // Detailed description
  properties: Record<string, any>; // Flexible properties (status, priority, etc.)
  embeddingId?: string;          // Reference to vector index entry
  createdAt: Date;
  updatedAt: Date;
  version: number;               // Increments on each update
}

export interface NodeInput {
  type: NodeType;
  subtype?: string;
  name: string;
  description?: string;
  properties?: Record<string, any>;
  embeddingId?: string;
}

export interface NodeFilter {
  type?: NodeType;
  subtype?: string;
  name?: string;
  status?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

// ============================================================================
// RELATIONSHIP INTERFACES
// ============================================================================

export interface Relationship {
  id: string;                    // UUID v4
  type: RelationshipType;
  fromId: string;                // Source node ID
  toId: string;                  // Target node ID
  properties: Record<string, any>;
  createdAt: Date;
  weight?: number;               // Optional weight (0-1)
}

export interface RelationshipInput {
  type: RelationshipType;
  fromId: string;
  toId: string;
  properties?: Record<string, any>;
  weight?: number;
}

// ============================================================================
// TRAVERSAL INTERFACES
// ============================================================================

export interface TraversalOptions {
  maxDepth: 1 | 2 | 3;          // How far to traverse
  relationshipTypes?: RelationshipType[]; // Filter by relationship types
  maxNodes?: number;             // Limit total nodes returned
  includeProperties?: boolean;   // Include full properties in result
  direction?: 'out' | 'in' | 'both'; // Direction of traversal
  filter?: NodeFilter;           // Filter nodes during traversal
}

export interface TraversalResult {
  nodes: Node[];
  relationships: Relationship[];
  paths: Array<{
    nodes: Node[];
    relationships: Relationship[];
  }>;
}

// ============================================================================
// EMBEDDING INTERFACES
// ============================================================================

export interface Embedding {
  vector: number[];              // 384-dim float array
  text: string;                  // Original text that was embedded
  textHash: string;              // Hash for caching
  tokenCount: number;            // Estimated token count
  dimensions: number;            // Should be 384
  modelName: string;             // 'all-MiniLM-L6-v2'
  version: string;               // Model version
  generatedAt: Date;
}

export interface EmbedOptions {
  useCache?: boolean;            // Use cached embedding if available
  normalize?: boolean;           // L2 normalize for cosine similarity
  batchSize?: number;            // For batch processing
}

// ============================================================================
// VECTOR INDEX INTERFACES
// ============================================================================

export interface VectorMetadata {
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  nodeDescription?: string;
  embeddingVersion: string;      // 'all-MiniLM-L6-v2'
  generatedAt: Date;
  textHash: string;              // For deduplication
  tokenCount?: number;
}

export interface VectorInput {
  id?: string;                   // Optional, auto-generated if not provided
  nodeId: string;                // Reference to graph node
  vector: number[];              // 384-dim array
  metadata: VectorMetadata;
}

export interface VectorEntry {
  id: string;
  nodeId: string;
  vector: number[];              // Normalized vector
  metadata: VectorMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchQuery {
  vector: number[];              // Query vector (384-dim)
  topK: number;                  // Number of results to return
  threshold?: number;            // Minimum similarity (0-1), default 0.6
  filter?: {
    nodeTypes?: NodeType[];
    status?: string[];
    dateRange?: { from: Date; to: Date };
  };
  includeMetadata?: boolean;     // Include full metadata in results
}

export interface SearchResult {
  vectorId: string;
  nodeId: string;
  similarity: number;            // Cosine similarity (0-1)
  metadata: VectorMetadata;
  distance: number;              // 1 - similarity
}

export interface RebuildOptions {
  batchSize?: number;            // Vectors per batch
  useExisting?: boolean;         // Reuse existing embeddings
  concurrency?: number;          // Parallel operations
  onProgress?: (progress: number) => void; // Progress callback
}

// ============================================================================
// MEMORY GRAPH INTERFACES
// ============================================================================

export interface ProjectSnapshot {
  project: Node;
  activeContext: Node | null;
  milestones: Node[];
  blockers: Node[];
  recentDecisions: Node[];       // Last 5 decisions
  recentEntities: Node[];        // Last 10 modified entities
  standards: Node[];
  stats: {
    totalNodes: number;
    totalRelationships: number;
    lastUpdated: Date;
  };
}

export interface SearchOptions {
  topK?: number;                 // Max results, default 10
  threshold?: number;            // Similarity threshold, default 0.6
  nodeTypes?: NodeType[];        // Filter by node types
  maxDepth?: number;             // For structural traversal, default 2
  includeStructural?: boolean;   // Include structural expansion, default true
  recencyWeight?: number;        // Weight for recency (0-1), default 0.2
  timeout?: number;              // Timeout in ms for the operation (default: 10_000)
}

export interface ContextSearchResult {
  nodes: Array<{
    node: Node;
    similarity: number;          // Semantic similarity score
    source: 'semantic' | 'structural' | 'ambient' | 'hybrid';
    score: number;               // Combined relevance score
  }>;
  relationships: Relationship[];
  totalResults: number;
  searchTime: number;            // Milliseconds
  truncated: boolean;
}

export interface MemoryMetadata {
  type?: NodeType;
  tags?: string[];
  source?: string;               // Where memory came from
  confidence?: number;           // 0-1
  timestamp?: Date;
}

export interface MemoryEntry {
  id: string;
  text: string;
  embeddingId: string;
  metadata: MemoryMetadata;
  nodeId?: string;               // If linked to a node
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CORE INTERFACES - IMPLEMENT THESE
// ============================================================================

/**
 * Interface 1: GraphDatabase
 * 
 * Purpose: Store and query nodes and relationships in a graph structure
 * Storage: In-memory with Maps (initial implementation)
 * Indexes: By type, name, status for fast lookups
 * 
 * Implementation Notes:
 * - Use Map<string, Node> for nodes
 * - Use Map<string, Relationship> for relationships
 * - Maintain indexes: byType, byName, byStatus, outgoingRelationships, incomingRelationships
 * - Generate UUID v4 for IDs
 * - Validate inputs before operations
 * - Throw custom errors for not found, validation, duplicates
 */
export interface IGraphDatabase {
  // --- Node Operations ---

  /**
   * Create a new node
   * - Generates UUID v4 id
   * - Sets createdAt and updatedAt to now
   * - Initializes version to 1
   * - Validates name and type are provided
   * - Throws DuplicateNodeError if node with same name and type exists
   * - Updates all indexes
   */
  createNode(node: NodeInput): Promise<Node>;

  /**
   * Get a node by ID
   * - Returns null if not found (not an error)
   * - Should be O(1) using Map lookup
   */
  getNode(id: string): Promise<Node | null>;

  /**
   * Update a node
   * - Updates updatedAt to now
   * - Increments version by 1
   * - Updates indexes if relevant fields change (type, name, status)
   * - Throws NodeNotFoundError if node doesn't exist
   * - Can update any field except id and createdAt
   */
  updateNode(id: string, updates: Partial<Node>): Promise<Node>;

  /**
   * Delete a node
   * - Deletes all relationships connected to this node (both in/out)
   * - Removes from all indexes
   * - Throws NodeNotFoundError if node doesn't exist
   */
  deleteNode(id: string): Promise<void>;

  /**
   * Query nodes with filtering
   * - Supports filtering by type, name, status, tags
   * - Supports pagination with limit and offset
   * - Returns empty array if no matches (not an error)
   */
  queryNodes(filter: NodeFilter): Promise<Node[]>;

  /**
   * Restore a node with a specific ID (for persistence restore).
   * Unlike createNode, this bypasses duplicate checks and uses the provided ID.
   * Throws NodeNotFoundError if a node with this ID already exists.
   */
  restoreNode(node: Node): Promise<void>;

  /**
   * Remove all nodes and relationships from the database.
   */
  clearAll(): Promise<void>;

  /**
   * Register a callback that fires after every mutation (create/update/delete
   * of nodes or relationships).  Useful for persistence auto-save.
   * Returns a dispose function to unregister.
   */
  onDidMutate(callback: () => void): { dispose: () => void };

  // --- Relationship Operations ---

  /**
   * Create a relationship between two nodes
   * - Validates both nodes exist
   * - Sets createdAt to now
   * - Updates outgoing/incoming relationship indexes
   * - Throws NodeNotFoundError if either node doesn't exist
   * - Throws ValidationError if fromId equals toId
   */
  createRelationship(rel: RelationshipInput): Promise<Relationship>;

  /**
   * Get all relationships for a node
   * - Returns both outgoing and incoming relationships
   * - Returns empty array if no relationships (not an error)
   * - Throws NodeNotFoundError if node doesn't exist
   */
  getRelationships(nodeId: string): Promise<Relationship[]>;

  /**
   * Delete a relationship by ID
   * - Removes from outgoing/incoming relationship indexes
   * - Throws RelationshipNotFoundError if relationship doesn't exist
   */
  deleteRelationship(id: string): Promise<void>;

  // --- Graph Traversal ---

  /**
   * Traverse the graph from a starting node
   * - Uses BFS algorithm
   * - Respects maxDepth (1-3)
   * - Can filter by relationship types
   * - Limits total nodes returned by maxNodes (default 100)
   * - Returns nodes, relationships, and paths
   * - Throws NodeNotFoundError if start node doesn't exist
   */
  traverse(startNodeId: string, options: TraversalOptions): Promise<TraversalResult>;
}

/**
 * Interface 2: Embedder
 * 
 * Purpose: Generate embeddings using all-MiniLM-L6-v2 model
 * Model: all-MiniLM-L6-v2 (384 dimensions) via @xenova/transformers
 * Cache: LRU cache with TTL for frequently used texts
 * 
 * Implementation Notes:
 * - Load model once and reuse (singleton pattern)
 * - Cache embeddings with text hash as key
 * - Support single and batch embedding generation
 * - L2 normalize vectors for cosine similarity
 * - Handle model loading errors gracefully
 * - Track token counts for budget management
 */
export interface IEmbedder {
  /**
   * Generate embedding for a single text
   * - Checks cache first (if useCache is true)
   * - Uses all-MiniLM-L6-v2 model via pipeline
   * - Returns 384-dim float array
   * - Throws InvalidTextError if text is empty
   * - Throws EmbeddingGenerationError if model fails
   */
  embed(text: string, options?: EmbedOptions): Promise<Embedding>;

  /**
   * Generate embeddings for multiple texts
   * - Processes in batches of 32 (configurable)
   * - Uses Promise.all for parallel processing
   * - Returns embeddings in same order as texts
   * - Individual failures are thrown (all-or-nothing)
   */
  embedBatch(texts: string[], options?: EmbedOptions): Promise<Embedding[]>;

  /**
   * Calculate cosine similarity between two vectors
   * - Both vectors should be 384-dim
   * - Assumes vectors are already L2 normalized
   * - Returns 0-1 (clamped)
   * - Throws DimensionMismatchError if dimensions differ
   */
  similarity(a: number[], b: number[]): number;

  /**
   * Load the embedding model
   * - Uses @xenova/transformers pipeline
   * - Sets up model for feature extraction
   * - Should be idempotent (can call multiple times)
   * - Throws ModelLoadError if loading fails
   */
  loadModel(): Promise<void>;

  /**
   * Unload the embedding model
   * - Frees model from memory
   * - Clears the embedding cache
   * - Idempotent (can call multiple times)
   */
  unloadModel(): Promise<void>;

  /**
   * Get embedding dimensions
   * - Should return 384 (all-MiniLM-L6-v2)
   * - Always available even if model isn't loaded
   */
  getDimensions(): number;
}

/**
 * Interface 3: VectorIndex
 * 
 * Purpose: Store and search embeddings for semantic retrieval
 * Storage: Map<string, Float32Array> for vectors
 * Metadata: Map<string, VectorMetadata>
 * Search: Brute-force cosine similarity with filtering
 * 
 * Implementation Notes:
 * - Store vectors as Float32Array for memory efficiency
 * - Maintain inverted index by type for filtering
 * - L2 normalize all vectors before storage
 * - Support filtering by type, status, date range
 * - Use cosine similarity for scoring
 * - Return results sorted by similarity (descending)
 * - Implement pagination for large result sets
 */
export interface IVectorIndex {
  /**
   * Insert a new vector
   * - Validates dimension (must be 384)
   * - Normalizes vector (L2 normalization)
   * - Generates ID if not provided (UUID)
   * - Updates inverted index for filtering
   * - Throws DimensionMismatchError if dimension invalid
   */
  insert(vector: VectorInput): Promise<VectorEntry>;

  /**
   * Update an existing vector
   * - Validates vector exists
   * - Validates dimension (must be 384)
   * - Normalizes vector (L2 normalization)
   * - Updates metadata with new timestamp
   * - Throws VectorNotFoundError if doesn't exist
   * - Throws DimensionMismatchError if dimension invalid
   */
  update(id: string, vector: number[]): Promise<VectorEntry>;

  /**
   * Delete a vector
   * - Removes from vectors Map
   * - Removes from metadata Map
   * - Removes from inverted index
   * - Throws VectorNotFoundError if doesn't exist
   */
  delete(id: string): Promise<void>;

  /**
   * Search for similar vectors
   * - Normalizes query vector
   * - Filters by nodeTypes if provided
   * - Calculates cosine similarity for all candidates
   * - Applies threshold filter (default 0.6)
   * - Sorts by similarity (descending)
   * - Returns topK results
   */
  search(query: SearchQuery): Promise<SearchResult[]>;

  /**
   * Rebuild the vector index
   * - For simple implementation: validate all vectors
   * - For FAISS integration: rebuild index from all vectors
   * - Should handle large datasets efficiently
   * - Provide progress callback for UI feedback
   */
  rebuild(options?: RebuildOptions): Promise<void>;
}

/**
 * Interface 4: MemoryGraph (Facade)
 * 
 * Purpose: Unified interface combining GraphDatabase, VectorIndex, and Embedder
 * Responsibility: Coordinate operations across all memory components
 * 
 * Implementation Notes:
 * - Inject all three dependencies via constructor
 * - Maintain consistency between graph and vector index
 * - Handle transactions across components
 * - Provide high-level operations for common tasks
 * - Implement caching for frequently accessed data
 */
export interface IMemoryGraph {
  // --- Graph Delegation Methods ---

  /**
   * Get a node by ID (delegates to GraphDatabase).
   */
  getNode(id: string): Promise<Node | null>;

  /**
   * Query nodes with filtering (delegates to GraphDatabase).
   */
  queryNodes(filter: NodeFilter): Promise<Node[]>;

  /**
   * Create a relationship between two nodes (delegates to GraphDatabase).
   */
  createRelationship(rel: RelationshipInput): Promise<Relationship>;

  /**
   * Get all relationships for a node (delegates to GraphDatabase).
   */
  getRelationships(nodeId: string): Promise<Relationship[]>;

  /**
   * Delete a relationship by ID (delegates to GraphDatabase).
   */
  deleteRelationship(id: string): Promise<void>;

  /**
   * Traverse the graph from a starting node (delegates to GraphDatabase).
   */
  traverse(startNodeId: string, options: TraversalOptions): Promise<TraversalResult>;

  // --- High-level Operations ---

  /**
   * Store a node with its embedding
   * - Creates node in graph
   * - Generates embedding from description (if exists)
   * - Stores embedding in vector index
   * - Updates node with embeddingId
   * - Transaction: if any step fails, rollback
   * - Throws DuplicateNodeError if name+type exists
   */
  storeNode(node: NodeInput): Promise<Node>;

  /**
   * Update a node and its embedding
   * - Updates node in graph
   * - If description changed, regenerates embedding
   * - Updates vector index if embedding changed
   * - Transaction: if any step fails, rollback
   * - Throws NodeNotFoundError if node doesn't exist
   */
  updateNode(id: string, updates: Partial<Node>): Promise<Node>;

  /**
   * Delete a node and its embedding
   * - Deletes node from graph
   * - Deletes embedding from vector index (if exists)
   * - Transaction: if any step fails, rollback
   * - Throws NodeNotFoundError if node doesn't exist
   */
  deleteNode(id: string): Promise<void>;

  /**
   * Get project context snapshot
   * - Returns project node, active context, milestones, blockers
   * - Returns recent decisions and entities
   * - Uses ambient retrieval pattern
   * - Can be cached with TTL
   */
  getProjectContext(): Promise<ProjectSnapshot>;

  /**
   * Search for context related to a query
   * - Embeds the query
   * - Searches vector index for semantic matches
   * - Expands with structural traversal (if includeStructural)
   * - Returns combined results with scores
   * - Respects threshold and topK
   */
  searchContext(query: string, options?: SearchOptions): Promise<ContextSearchResult>;

  /**
   * Add a memory entry
   * - Embeds the text
   * - Creates a MemoryEntry with metadata
   * - Links to graph node if provided
   * - For conversation memory and learning
   */
  addMemory(text: string, metadata?: MemoryMetadata): Promise<MemoryEntry>;

  /**
   * Recall memory entries
   * - Embeds the query
   * - Searches for similar memory entries
   * - Returns top matches
   * - For cross-session context
   */
  recall(query: string, limit?: number): Promise<MemoryEntry[]>;

  /**
   * Sync all components
   * - Check consistency between graph and vector index
   * - Rebuild vector index if needed
   * - Clean up orphaned vectors
   * - Validate embeddings exist for all nodes
   */
  sync(): Promise<void>;
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class NodeNotFoundError extends Error {
  constructor(id: string) {
    super(`Node with ID ${id} not found`);
    this.name = 'NodeNotFoundError';
  }
}

export class RelationshipNotFoundError extends Error {
  constructor(id: string) {
    super(`Relationship with ID ${id} not found`);
    this.name = 'RelationshipNotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateNodeError extends Error {
  constructor(name: string, type: NodeType) {
    super(`Node with name "${name}" and type "${type}" already exists`);
    this.name = 'DuplicateNodeError';
  }
}

export class ModelLoadError extends Error {
  constructor(message: string) {
    super(`Model load failed: ${message}`);
    this.name = 'ModelLoadError';
  }
}

export class EmbeddingGenerationError extends Error {
  constructor(message: string) {
    super(`Embedding generation failed: ${message}`);
    this.name = 'EmbeddingGenerationError';
  }
}

export class InvalidTextError extends Error {
  constructor(message: string) {
    super(`Invalid text: ${message}`);
    this.name = 'InvalidTextError';
  }
}

export class VectorNotFoundError extends Error {
  constructor(id: string) {
    super(`Vector with ID ${id} not found`);
    this.name = 'VectorNotFoundError';
  }
}

export class DimensionMismatchError extends Error {
  constructor(expected: number, got: number) {
    super(`Dimension mismatch: expected ${expected}, got ${got}`);
    this.name = 'DimensionMismatchError';
  }
}

export class IndexBuildError extends Error {
  constructor(message: string) {
    super(`Index build failed: ${message}`);
    this.name = 'IndexBuildError';
  }
}

export class ConsistencyError extends Error {
  constructor(message: string) {
    super(`Consistency error: ${message}`);
    this.name = 'ConsistencyError';
  }
}
