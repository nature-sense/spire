import { Container } from 'inversify';
import 'reflect-metadata';

// Interfaces
import { IGraphDatabase, IVectorIndex, IEmbedder, IMemoryGraph } from '../interfaces/memory';

export const TYPES = {
  IGraphDatabase: Symbol.for('IGraphDatabase'),
  IVectorIndex: Symbol.for('IVectorIndex'),
  IEmbedder: Symbol.for('IEmbedder'),
  IMemoryGraph: Symbol.for('IMemoryGraph'),
  ICrossSessionRetriever: Symbol.for('ICrossSessionRetriever'),
};

export const container = new Container();

/**
 * Initialize the DI container by binding all memory implementation classes.
 *
 * This is called explicitly (not at module load time) to avoid a circular
 * dependency between types.ts and MemoryGraph.ts:
 *
 *   types.ts ──imports──► MemoryGraph.ts ──imports──► types.ts (TYPES)
 *
 * By deferring the implementation imports to an async function, TYPES is
 * fully defined before any implementation module is evaluated, breaking
 * the cycle.
 */
export async function initializeContainer(): Promise<void> {
  const { GraphDatabase } = await import('../../memory/GraphDatabase');
  const { VectorIndex } = await import('../../memory/VectorIndex');
  const { Embedder } = await import('../../memory/Embedder');
  const { MemoryGraph } = await import('../../memory/MemoryGraph');

  container.bind<IGraphDatabase>(TYPES.IGraphDatabase).to(GraphDatabase).inSingletonScope();
  container.bind<IVectorIndex>(TYPES.IVectorIndex).to(VectorIndex).inSingletonScope();
  container.bind<IEmbedder>(TYPES.IEmbedder).to(Embedder).inSingletonScope();
  container.bind<IMemoryGraph>(TYPES.IMemoryGraph).to(MemoryGraph).inSingletonScope();
}
