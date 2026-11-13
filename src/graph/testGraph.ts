// Grafo sintético para validar a renderização com milhares de nós (Fase 0).
import type { GraphData, GraphEdge, GraphNode } from "./types";

/** PRNG determinístico (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTestGraph(nodeCount: number, seed = 42): GraphData {
  const rand = rng(seed);
  const communities = Math.max(1, Math.round(Math.sqrt(nodeCount) / 2));
  const members: number[][] = Array.from({ length: communities }, () => []);

  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const c = Math.floor(rand() * communities);
    members[c].push(i);
    nodes.push({
      id: `test_${i}`,
      label: `node_${i}()`,
      community: c,
      fileType: "code",
      sourceFile: `src/module_${c}/file_${i % 17}.ts`,
      sourceLocation: `L${1 + Math.floor(rand() * 400)}`,
    });
  }

  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const own = members[nodes[i].community!];
    const links = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < links; k++) {
      const pool = rand() < 0.9 ? own : members[Math.floor(rand() * communities)];
      if (pool.length === 0) continue;
      const j = pool[Math.floor(rand() * pool.length)];
      if (j !== i) edges.push({ source: i, target: j, relation: "calls" });
    }
  }
  return { nodes, edges };
}
