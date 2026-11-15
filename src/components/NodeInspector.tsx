import { useMemo } from "react";
import { Icon } from "./Icons";
import { communityCss } from "../graph/palette";
import { graphStore, nodeIndexOf, nodesOfCommunity, sceneApi, selectNode } from "../state/graph";
import { projectStore } from "../state/project";
import { openInEditor, parseLine } from "../state/editor";
import { joinRel } from "../lib/paths";

/** Inspetor contextual do nó selecionado, flutuando sobre o grafo. */
export function NodeInspector() {
  const graph = graphStore.use((s) => s.graph);
  const selectedId = graphStore.use((s) => s.selectedId);
  const root = projectStore.use((s) => s.root);
  const selected = nodeIndexOf(selectedId);

  const neighbors = useMemo(() => {
    if (!graph || selected === null) return [];
    const out: { index: number; relation: string | null; outgoing: boolean }[] = [];
    for (const e of graph.edges) {
      if (e.source === selected) out.push({ index: e.target, relation: e.relation, outgoing: true });
      else if (e.target === selected) out.push({ index: e.source, relation: e.relation, outgoing: false });
    }
    return out;
  }, [graph, selected]);

  if (!graph || selected === null) return null;
  const node = graph.nodes[selected];
  const canOpen = !!(root && node.sourceFile);

  return (
    <aside className="inspector glass" key={node.id}>
      <header className="inspector-head">
        <div className="inspector-kicker">
          <span className="community-dot" style={{ background: communityCss(node.community) }} />
          {node.fileType ?? "nó"} · comunidade {node.community ?? "—"}
        </div>
        <button className="icon-btn" title="Limpar seleção (Esc)" onClick={() => selectNode(null)}>
          <Icon name="x" />
        </button>
      </header>
      <h2 className="inspector-title" title={node.label}>
        {node.label}
      </h2>
      {node.sourceFile && (
        <button
          className="inspector-path"
          disabled={!canOpen}
          title="Abrir no editor"
          onClick={() => canOpen && openInEditor(joinRel(root!, node.sourceFile!), parseLine(node.sourceLocation))}
        >
          {node.sourceFile}
          {node.sourceLocation && <span className="loc">{node.sourceLocation}</span>}
        </button>
      )}

      <div className="inspector-actions">
        <button
          className="btn btn-primary"
          disabled={!canOpen}
          onClick={() => openInEditor(joinRel(root!, node.sourceFile!), parseLine(node.sourceLocation))}
        >
          <Icon name="code" /> Abrir arquivo
        </button>
        <button className="btn" onClick={() => sceneApi()?.focusNodes([selected])} title="Centralizar nó">
          <Icon name="target" />
        </button>
        <button
          className="btn"
          onClick={() => sceneApi()?.focusNodes(nodesOfCommunity(node.community))}
          title="Explorar a comunidade"
        >
          <Icon name="layers" />
        </button>
      </div>

      <div className="inspector-section">
        <span>Conexões</span>
        <span className="count">{neighbors.length}</span>
      </div>
      <ul className="inspector-neighbors">
        {neighbors.slice(0, 300).map((nb, k) => {
          const other = graph.nodes[nb.index];
          return (
            <li key={k} onClick={() => selectNode(nb.index, { fly: true })} title={other.sourceFile ?? other.id}>
              <span className={`rel ${nb.outgoing ? "out" : "in"}`}>
                {nb.outgoing ? "→" : "←"} {nb.relation ?? ""}
              </span>
              <span className="name">{other.label}</span>
            </li>
          );
        })}
        {neighbors.length > 300 && (
          <li className="inspector-more">Mostrando 300 de {neighbors.length.toLocaleString("pt-BR")} conexões.</li>
        )}
      </ul>
    </aside>
  );
}
