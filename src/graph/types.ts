// Modelo interno do grafo (convertido pelo backend a partir do graph.json do Graphify).

export interface GraphNode {
  id: string;
  label: string;
  community: number | null;
  fileType: string | null;
  sourceFile: string | null;
  sourceLocation: string | null;
}

export interface GraphEdge {
  /** Índice em `nodes`. */
  source: number;
  target: number;
  relation: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
