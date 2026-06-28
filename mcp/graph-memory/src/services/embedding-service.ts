import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

let embedder: FeatureExtractionPipeline | null = null;
let isReady = false;
let initPromise: Promise<void> | null = null;

export async function initializeEmbedder(): Promise<void> {
  if (isReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.error('[graph-memory] 🔄 Loading embedding model (all-MiniLM-L6-v2)...');
    try {
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
      });
      isReady = true;
      console.error('[graph-memory] ✅ Embedding model loaded');
    } catch (err) {
      console.error('[graph-memory] ❌ Failed to load embedding model:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

export async function embed(text: string): Promise<number[]> {
  if (!isReady) await initializeEmbedder();
  if (!embedder) throw new Error('Embedder not initialized');

  const result = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!isReady) await initializeEmbedder();
  if (!embedder) throw new Error('Embedder not initialized');

  const result = await embedder(texts, { pooling: 'mean', normalize: true });
  return result.tolist() as number[][];
}

export function isEmbedderReady(): boolean {
  return isReady;
}
