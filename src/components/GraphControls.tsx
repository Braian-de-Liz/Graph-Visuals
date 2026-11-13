import { Icon } from "./Icons";
import { graphStore, nodeIndexOf, runAnalysis, sceneApi, selectNode } from "../state/graph";
import { projectStore } from "../state/project";
import { settingsStore } from "../state/settings";

/** Controles espaciais do grafo (canto inferior direito do viewport). */
export function GraphControls() {
  const selectedId = graphStore.use((s) => s.selectedId);
  const status = graphStore.use((s) => s.status);
  const hasGraph = graphStore.use((s) => !!s.graph);
  const root = projectStore.use((s) => s.root);
  const ambient = settingsStore.use((s) => s.ambientMotion);
  const sel = nodeIndexOf(selectedId);

  return (
    <div className="graph-controls glass">
      <button className="icon-btn" title="Visão geral" disabled={!hasGraph} onClick={() => sceneApi()?.resetView()}>
        <Icon name="home" />
      </button>
      <button
        className="icon-btn"
        title="Centralizar seleção"
        disabled={sel === null}
        onClick={() => sel !== null && sceneApi()?.focusNodes([sel])}
      >
        <Icon name="target" />
      </button>
      <button className="icon-btn" title="Limpar seleção" disabled={sel === null} onClick={() => selectNode(null)}>
        <Icon name="x" />
      </button>
      <span className="divider" />
      <button
        className={`icon-btn ${ambient ? "on" : ""}`}
        title="Movimento ambiente (mantém a GPU ativa)"
        onClick={() => settingsStore.set({ ambientMotion: !ambient })}
      >
        <Icon name="orbit" />
      </button>
      <button
        className={`icon-btn ${status === "analyzing" ? "spin" : ""}`}
        title="Regenerar grafo com o Graphify"
        disabled={!root || status === "analyzing"}
        onClick={() => void runAnalysis()}
      >
        <Icon name="refresh" />
      </button>
    </div>
  );
}
