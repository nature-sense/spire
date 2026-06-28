// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { create, insert, search, remove, count, Orama } from '@orama/orama';

type OramaInstance = any;
import { embed, initializeEmbedder } from './embedding-service.js';

let oramaIndex: OramaInstance | null = null;
let isReady = false;
let initPromise: Promise<void> | null = null;

export async function initializeOrama(): Promise<void> {
  if (isReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Ensure embedder is ready first
    await initializeEmbedder();

    console.error('[graph-memory] 📦 Initializing Orama index...');
    oramaIndex = await create({
      schema: {
        sparrow_id: 'string',
        name: 'string',
        content: 'string',
        category: 'string',
        embedding: 'vector[384]',
        timestamp: 'number',
      } as any,
    });
    isReady = true;
    console.error('[graph-memory] ✅ Orama index initialized');
  })();

  return initPromise;
}

export async function indexNode(node: {
  id: string;
  name: string;
  details?: string;
  category?: string;
}): Promise<void> {
  if (!isReady) await initializeOrama();
  if (!oramaIndex) throw new Error('Orama not initialized');

  const text = `${node.name || ''} ${node.details || ''}`.trim();
  if (!text) return;

  try {
    const embeddingVec = await embed(text);
    if (embeddingVec.length !== 384) {
      console.error(`[graph-memory] ⚠️ Embedding dimension mismatch: expected 384, got ${embeddingVec.length}`);
      return;
    }

    await insert(oramaIndex, {
      sparrow_id: node.id,
      name: node.name || '',
      content: node.details || '',
      category: node.category || 'concept',
      embedding: embeddingVec,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error(`[graph-memory] ⚠️ Failed to index node "${node.name}":`, err);
  }
}

export async function removeFromIndex(sparrowId: string): Promise<boolean> {
  if (!isReady) await initializeOrama();
  if (!oramaIndex) throw new Error('Orama not initialized');

  try {
    const results = await search(oramaIndex, {
      term: sparrowId,
      properties: ['sparrow_id'],
      limit: 1,
    } as any);

    if (results.hits.length > 0) {
      await remove(oramaIndex, results.hits[0].id);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[graph-memory] ⚠️ Failed to remove "${sparrowId}" from index:`, err);
    return false;
  }
}

export async function semanticSearch(
  query: string,
  limit: number = 10,
): Promise<Array<{
  id: string;
  name: string;
  content: string;
  category: string;
  score: number;
}>> {
  if (!isReady) await initializeOrama();
  if (!oramaIndex) throw new Error('Orama not initialized');

  try {
    const queryEmbedding = await embed(query);

    const results = await search(oramaIndex, {
      mode: 'hybrid',
      vector: { value: queryEmbedding, property: 'embedding' },
      term: query,
      properties: ['name', 'content'],
      limit,
      hybrid: { vectorWeight: 0.7, termWeight: 0.3 },
    } as any);

    return results.hits.map((hit: any) => ({
      id: hit.document.sparrow_id,
      name: hit.document.name,
      content: hit.document.content,
      category: hit.document.category,
      score: hit.score,
    }));
  } catch (err) {
    console.error(`[graph-memory] ⚠️ Semantic search failed:`, err);
    return [];
  }
}

export async function backfillIndex(sparrowDB: any): Promise<void> {
  if (!isReady) await initializeOrama();
  if (!oramaIndex) throw new Error('Orama not initialized');

  console.error('[graph-memory] 📦 Checking if backfill needed...');
  const docCount = await count(oramaIndex);
  if (docCount > 0) {
    console.error(`[graph-memory] Orama index already has ${docCount} entries — skipping backfill`);
    return;
  }

  console.error('[graph-memory] 📦 Backfilling Orama index from SparrowDB...');
  try {
    const result = sparrowDB.execute('MATCH (n:Entity) RETURN n');
    let indexed = 0;
    for (const row of result.rows) {
      const node = row['n'];
      if (node && typeof node === 'object') {
        const nodeObj = node as Record<string, unknown>;
        await indexNode({
          id: String(nodeObj.id ?? ''),
          name: String(nodeObj.name ?? ''),
          details: String(nodeObj.details ?? ''),
          category: String(nodeObj.category ?? 'concept'),
        });
        indexed++;
        if (indexed % 50 === 0) {
          console.error(`[graph-memory] 📦 Backfilled ${indexed} nodes...`);
        }
      }
    }
    console.error(`[graph-memory] ✅ Backfilled ${indexed} nodes into Orama index`);
  } catch (err) {
    console.error('[graph-memory] ⚠️ Backfill failed:', err);
  }
}

export function isOramaReady(): boolean {
  return isReady;
}
