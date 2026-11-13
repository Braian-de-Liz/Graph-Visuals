import { useEffect, useRef, useState } from "react";
import { GraphScene } from "./GraphScene";
import type { LayoutRequest, LayoutResponse } from "./layout.worker";
import { graphStore, nodeIndexOf, nodesOfFile, registerScene, selectNode } from "../state/graph";
import { settingsStore } from "../state/settings";
import { activityStore, onActivity } from "../state/activity";

/** Monta a cena 3D, executa o layout no worker e sincroniza a seleção. */
export function GraphCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const prevPositions = useRef(new Map<string, [number, number, number]>());
  const graph = graphStore.use((s) => s.graph);
  const selectedId = graphStore.use((s) => s.selectedId);
  const ambient = settingsStore.use((s) => s.ambientMotion);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const scene = new GraphScene(containerRef.current!, {
      onSelect: (i) => selectNode(i),
      onHover: (i, x, y) => setHover(i === null ? null : { i, x, y }),
    });
    sceneRef.current = scene;
    registerScene({
      focusNodes: (list) => scene.focusNodes(list),
      resetView: () => scene.resetView(),
    });
    return () => {
      registerScene(null);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => sceneRef.current?.setAmbient(ambient), [ambient]);

  // Arquivos gravados durante sessões de agentes: brilho nos nós do arquivo.
  useEffect(
    () =>
      onActivity((rels, at) => {
        const indices = rels.flatMap((r) => nodesOfFile(r));
        sceneRef.current?.setActivity(indices, at);
      }),
    [],
  );

  // Layout no Web Worker; um grafo mais novo cancela o layout anterior.
  useEffect(() => {
    if (!graph) {
      sceneRef.current?.clear();
      prevPositions.current = new Map();
      return;
    }
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    const n = graph.nodes.length;
    const edges = new Uint32Array(graph.edges.length * 2);
    graph.edges.forEach((e, k) => {
      edges[k * 2] = e.source;
      edges[k * 2 + 1] = e.target;
    });
    const prev = new Float32Array(n * 3);
    const hasPrev = new Uint8Array(n);
    let preserved = 0;
    graph.nodes.forEach((node, i) => {
      const p = prevPositions.current.get(node.id);
      if (p) {
        prev.set(p, i * 3);
        hasPrev[i] = 1;
        preserved++;
      }
    });
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const positions = e.data.positions;
      sceneRef.current?.setGraph(graph, positions, preserved > 0, e.data.stars);
      // Reaplica o brilho de atividade recente no grafo reconstruído.
      for (const [key, at] of activityStore.get().recent) sceneRef.current?.setActivity(nodesOfFile(key), at);
      const map = new Map<string, [number, number, number]>();
      graph.nodes.forEach((node, i) => map.set(node.id, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]));
      prevPositions.current = map;
      setLayoutVersion((v) => v + 1);
      worker.terminate();
    };
    const req: LayoutRequest = {
      ids: graph.nodes.map((x) => x.id),
      communities: graph.nodes.map((x) => x.community),
      edges,
      prev,
      hasPrev,
    };
    worker.postMessage(req, [edges.buffer, prev.buffer, hasPrev.buffer]);
    return () => worker.terminate();
  }, [graph]);

  useEffect(() => {
    sceneRef.current?.setSelection(nodeIndexOf(selectedId));
  }, [selectedId, layoutVersion]);

  const hovered = hover && graph?.nodes[hover.i];
  return (
    <div className="graph-canvas" ref={containerRef}>
      {hovered && (
        <div className="graph-hover" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          <strong>{hovered.label}</strong>
          {hovered.sourceFile && <span>{hovered.sourceFile}</span>}
        </div>
      )}
    </div>
  );
}
