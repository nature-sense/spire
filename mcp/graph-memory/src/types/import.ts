export interface EntityNode {
  id: string;
  name: string;
  details: string;
  type: 'code' | 'project' | 'person' | 'memory' | 'concept' | 'documentation';
  category?: string;
  status?: string;
  goal?: string;
  valid_from: string;
  valid_to: string | null;
  version: number;
  source: string;
  source_version?: string;
  ingested_at: string;
  language?: 'python' | 'cpp' | 'dart' | 'markdown' | 'typescript';
  file_path?: string;
  signature?: string;
  body_preview?: string;
  start_line?: number;
  end_line?: number;
  hash?: string;
  created_at: string;
  updated_at: string;
}

export type RelationshipType =
  | 'DEPENDS_ON' | 'LEADS' | 'INSPIRED_BY' | 'BLOCKS'
  | 'RELATED_TO' | 'MENTIONS' | 'SUPERSEDED_BY'
  | 'DEFINED_IN' | 'CONTAINS' | 'IMPORTS';

export interface Relationship {
  type: RelationshipType;
  source_id: string;
  target_id: string;
  evidence?: string;
  source?: string;
  confidence?: number;
  valid_from?: string;
  valid_to?: string | null;
}

export interface ImportResult {
  success: boolean;
  file: string;
  file_hash?: string;
  entities_found: number;
  nodes_created: number;
  nodes_updated: number;
  relationships_created: number;
  nodes: EntityNode[];
  edges: Relationship[];
  errors: string[];
  summary?: string;
}

export interface LoadResult {
  created: number;
  updated: number;
  relationshipCount: number;
}
