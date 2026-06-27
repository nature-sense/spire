export interface ViewerNode {
  id: string;
  name: string;
  type: string;
  category?: string;
  language?: string;
  file_path?: string;
  signature?: string;
  details?: string;
  created_at?: string;
  status?: string;
  goal?: string;
  source?: string;
  version?: number;
  hash?: string;
  start_line?: number;
  end_line?: number;
}

export interface ViewerEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface ViewerGraphData {
  nodes: ViewerNode[];
  edges: ViewerEdge[];
  metadata: {
    node_count: number;
    edge_count: number;
    types: Record<string, number>;
    generated_at: string;
  };
}
