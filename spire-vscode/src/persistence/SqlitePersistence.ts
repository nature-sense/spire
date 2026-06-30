/**
 * SqlitePersistence — Save/restore the in-memory graph database and vector index
 * to/from a SQLite file using sql.js (pure JS/WASM SQLite).
 *
 * Strategy:
 *   - On VS Code close / workspace change: call save() to dump all state to .db file
 *   - On VS Code open: call load() to restore state from .db file
 *   - File location: <workspaceRoot>/.spire/memory.db
 *
 * sql.js keeps the entire DB in WASM memory. We export() to a Uint8Array and
 * write that to disk via fs.writeFileSync. On load, we read the file and pass
 * it to the SQL.Database constructor.
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { SqlJsStatic, Database } from 'sql.js';
import {
  IGraphDatabase,
  IVectorIndex,
  Node,
  Relationship,
} from '../core/interfaces/memory';

export class SqlitePersistence {
  private dbPath: string;
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;

  // Debounced auto-save
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSaveGraph: IGraphDatabase | null = null;
  private autoSaveVectors: IVectorIndex | null = null;
  private autoSaveDispose: (() => void) | null = null;
  private readonly AUTO_SAVE_DELAY_MS = 2000; // 2 second debounce

  constructor(workspaceRoot: string) {
    const dir = path.join(workspaceRoot, '.spire');
    this.dbPath = path.join(dir, 'memory.db');
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Subscribe to graph mutations and auto-save on every change.
   * Uses a 2-second debounce to avoid hammering the disk.
   * Call the returned dispose function to unsubscribe.
   */
  subscribeToMutations(graph: IGraphDatabase, vectors: IVectorIndex): { dispose: () => void } {
    // Unsubscribe from previous subscription if any
    if (this.autoSaveDispose) {
      this.autoSaveDispose();
    }

    this.autoSaveGraph = graph;
    this.autoSaveVectors = vectors;

    const sub = graph.onDidMutate(() => {
      this._scheduleAutoSave();
    });

    this.autoSaveDispose = () => {
      sub.dispose();
      this._cancelAutoSave();
      this.autoSaveGraph = null;
      this.autoSaveVectors = null;
      this.autoSaveDispose = null;
    };

    return { dispose: this.autoSaveDispose };
  }

  private _scheduleAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      if (this.autoSaveGraph && this.autoSaveVectors) {
        this.save(this.autoSaveGraph, this.autoSaveVectors).catch((err) => {
          console.error('[SqlitePersistence] Auto-save failed:', err);
        });
      }
    }, this.AUTO_SAVE_DELAY_MS);
  }

  private _cancelAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Save the current state of graph database and vector index to SQLite.
   * Creates the .spire directory and .db file if they don't exist.
   */
  async save(graph: IGraphDatabase, vectors: IVectorIndex): Promise<void> {
    await this.ensureDb();

    // Fetch all data from the in-memory stores
    const nodes = await graph.queryNodes({});
    const allRels: Relationship[] = [];
    for (const node of nodes) {
      const rels = await graph.getRelationships(node.id);
      allRels.push(...rels);
    }

    // Fetch all vectors via search with threshold=0 and large topK
    const vectorResults = await vectors.search({
      vector: new Array(384).fill(0),
      topK: 10000,
      threshold: 0,
    });

    // Transaction: clear + write
    const db = this.db!;
    db.run('BEGIN TRANSACTION');
    try {
      db.run('DELETE FROM nodes');
      db.run('DELETE FROM relationships');
      db.run('DELETE FROM vectors');

      // Insert nodes
      const nodeStmt = db.prepare(
        `INSERT INTO nodes (id, type, subtype, name, description, properties, embedding_id, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const n of nodes) {
        nodeStmt.run([
          n.id,
          n.type,
          n.subtype ?? null,
          n.name,
          n.description ?? null,
          JSON.stringify(n.properties),
          n.embeddingId ?? null,
          n.createdAt.toISOString(),
          n.updatedAt.toISOString(),
          n.version,
        ]);
      }
      nodeStmt.free();

      // Insert relationships
      const relStmt = db.prepare(
        `INSERT INTO relationships (id, type, from_id, to_id, properties, created_at, weight)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of allRels) {
        relStmt.run([
          r.id,
          r.type,
          r.fromId,
          r.toId,
          JSON.stringify(r.properties),
          r.createdAt.toISOString(),
          r.weight ?? null,
        ]);
      }
      relStmt.free();

      // Insert vectors (metadata + raw vector as binary blob)
      const vecStmt = db.prepare(
        `INSERT INTO vectors (id, node_id, vector, node_type, node_name, node_description, embedding_version, generated_at, text_hash, token_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of vectorResults) {
        // We can't recover the raw vector from search results, so store a placeholder
        // The vector index will be rebuilt from node embeddings on load
        const placeholder = new Float32Array(384);
        vecStmt.run([
          r.vectorId,
          r.nodeId,
          Buffer.from(placeholder.buffer),
          r.metadata.nodeType,
          r.metadata.nodeName,
          r.metadata.nodeDescription ?? null,
          r.metadata.embeddingVersion,
          r.metadata.generatedAt.toISOString(),
          r.metadata.textHash,
          r.metadata.tokenCount ?? null,
        ]);
      }
      vecStmt.free();

      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }

    // Write to disk
    this.flushToDisk();
  }

  /**
   * Load persisted state from SQLite into the in-memory graph database and vector index.
   * Returns the number of nodes restored (0 if no file exists).
   */
  async load(graph: IGraphDatabase, vectors: IVectorIndex): Promise<number> {
    if (!fs.existsSync(this.dbPath)) {
      return 0;
    }

    await this.ensureDb();

    const db = this.db!;

    // Check if tables exist
    const tableCheck = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'`
    );
    if (tableCheck.length === 0) {
      return 0;
    }

    // Clear existing in-memory state before restoring
    await graph.clearAll();

    // Restore nodes
    const nodeRows = db.exec('SELECT * FROM nodes ORDER BY created_at ASC');
    let restoredCount = 0;
    if (nodeRows.length > 0) {
      const columns = nodeRows[0].columns;
      const idIdx = columns.indexOf('id');
      const typeIdx = columns.indexOf('type');
      const subtypeIdx = columns.indexOf('subtype');
      const nameIdx = columns.indexOf('name');
      const descIdx = columns.indexOf('description');
      const propsIdx = columns.indexOf('properties');
      const embIdx = columns.indexOf('embedding_id');
      const createdIdx = columns.indexOf('created_at');
      const updatedIdx = columns.indexOf('updated_at');
      const verIdx = columns.indexOf('version');

      for (const row of nodeRows[0].values) {
        const node: Node = {
          id: row[idIdx] as string,
          type: row[typeIdx] as any,
          subtype: (row[subtypeIdx] as string) ?? undefined,
          name: row[nameIdx] as string,
          description: (row[descIdx] as string) ?? undefined,
          properties: JSON.parse(row[propsIdx] as string),
          embeddingId: (row[embIdx] as string) ?? undefined,
          createdAt: new Date(row[createdIdx] as string),
          updatedAt: new Date(row[updatedIdx] as string),
          version: row[verIdx] as number,
        };
        await graph.restoreNode(node);
        restoredCount++;
      }
    }

    // Restore relationships
    const relRows = db.exec('SELECT * FROM relationships ORDER BY created_at ASC');
    if (relRows.length > 0) {
      const columns = relRows[0].columns;
      const typeIdx = columns.indexOf('type');
      const fromIdx = columns.indexOf('from_id');
      const toIdx = columns.indexOf('to_id');
      const propsIdx = columns.indexOf('properties');
      const weightIdx = columns.indexOf('weight');

      for (const row of relRows[0].values) {
        try {
          await graph.createRelationship({
            type: row[typeIdx] as any,
            fromId: row[fromIdx] as string,
            toId: row[toIdx] as string,
            properties: JSON.parse(row[propsIdx] as string),
            weight: (row[weightIdx] as number) ?? undefined,
          });
        } catch {
          // Skip if relationship can't be created (e.g. missing node)
        }
      }
    }

    // Restore vectors (metadata only — vectors will be regenerated on next embed)
    const vecRows = db.exec('SELECT * FROM vectors ORDER BY generated_at ASC');
    if (vecRows.length > 0) {
      const columns = vecRows[0].columns;
      const idIdx = columns.indexOf('id');
      const nodeIdIdx = columns.indexOf('node_id');
      const nodeTypeIdx = columns.indexOf('node_type');
      const nodeNameIdx = columns.indexOf('node_name');
      const nodeDescIdx = columns.indexOf('node_description');
      const embVerIdx = columns.indexOf('embedding_version');
      const genAtIdx = columns.indexOf('generated_at');
      const hashIdx = columns.indexOf('text_hash');
      const tokIdx = columns.indexOf('token_count');

      for (const row of vecRows[0].values) {
        try {
          await vectors.insert({
            id: row[idIdx] as string,
            nodeId: row[nodeIdIdx] as string,
            vector: new Array(384).fill(0), // Placeholder — will be regenerated
            metadata: {
              nodeId: row[nodeIdIdx] as string,
              nodeType: row[nodeTypeIdx] as any,
              nodeName: row[nodeNameIdx] as string,
              nodeDescription: (row[nodeDescIdx] as string) ?? undefined,
              embeddingVersion: row[embVerIdx] as string,
              generatedAt: new Date(row[genAtIdx] as string),
              textHash: row[hashIdx] as string,
              tokenCount: (row[tokIdx] as number) ?? undefined,
            },
          });
        } catch {
          // Skip if vector already exists
        }
      }
    }

    return restoredCount;
  }

  /**
   * Delete the SQLite database file.
   */
  clear(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async ensureDb(): Promise<void> {
    if (this.db) return;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize sql.js
    this.SQL = await initSqlJs();

    // Open or create database
    if (fs.existsSync(this.dbPath)) {
      const fileData = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fileData);
    } else {
      this.db = new this.SQL.Database();
    }

    // Ensure schema exists
    this.ensureSchema();
  }

  private ensureSchema(): void {
    const db = this.db!;
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        subtype TEXT,
        name TEXT NOT NULL,
        description TEXT,
        properties TEXT DEFAULT '{}',
        embedding_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER DEFAULT 1
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        properties TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        weight REAL,
        FOREIGN KEY (from_id) REFERENCES nodes(id),
        FOREIGN KEY (to_id) REFERENCES nodes(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        vector BLOB,
        node_type TEXT NOT NULL,
        node_name TEXT NOT NULL,
        node_description TEXT,
        embedding_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        token_count INTEGER
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_rels_from ON relationships(from_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_rels_to ON relationships(to_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_vectors_node ON vectors(node_id)');
  }

  private flushToDisk(): void {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }
}
