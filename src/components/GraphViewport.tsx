import { useState } from "react";
import { GraphCanvas } from "../graph/GraphCanvas";
import { GraphControls } from "./GraphControls";
import { NodeInspector } from "./NodeInspector";
import { LocateConfirm } from "./QuickSpatialFind";
import { BrandMark, Icon } from "./Icons";
import { graphStore, runAnalysis } from "../state/graph";
import { openProject, pickAndOpenProject, projectStore } from "../state/project";
import { settingsStore } from "../state/settings";

/** Região central superior: grafo 3D e suas camadas de interface. */
export function GraphViewport() {
  const root = projectStore.use((s) => s.root);
  const graph = graphStore.use((s) => s.graph);
  const status = graphStore.use((s) => s.status);

  return (
    <section className="graph-viewport">
      <GraphCanvas />
      <div className="viewport-vignette" />
      {graph && <GraphLegend />}
      {!root && !graph && <Welcome />}
      {root && !graph && <GraphPlaceholder />}
      {graph && <GraphControls />}
      <NodeInspector />
      <LocateConfirm />
      {status === "analyzing" && graph && <div className="scanline" />}
    </section>
  );
}

function GraphLegend() {
  const graph = graphStore.use((s) => s.graph)!;
  const communities = new Set(graph.nodes.map((n) => n.community)).size;
  return (
    <div className="graph-legend">
      <div className="legend-figures">
        <Figure value={graph.nodes.length} label="nós" />
        <Figure value={graph.edges.length} label="arestas" />
        <Figure value={communities} label="comunidades" />
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="figure">
      <strong>{value.toLocaleString("pt-BR")}</strong>
      <span>{label}</span>
    </div>
  );
}

function Welcome() {
  const recent = settingsStore.use((s) => s.recentProjects);
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <BrandMark size={40} />
      </div>
      <h1>
        Graph <span>Visuals</span>
      </h1>
      <p>Abra um projeto para explorá-lo como um grafo tridimensional.</p>
      <button className="btn btn-primary btn-lg" onClick={() => void pickAndOpenProject()}>
        <Icon name="folderOpen" /> Abrir projeto
      </button>
      {recent.length > 0 && (
        <div className="welcome-recent">
          <span className="eyebrow">Recentes</span>
          {recent.map((p) => (
            <button key={p} className="recent-item" onClick={() => void openProject(p)} title={p}>
              <Icon name="folder" />
              <span className="recent-name">{p.split(/[/\\]/).pop()}</span>
              <span className="recent-path">{p}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GraphPlaceholder() {
  const status = graphStore.use((s) => s.status);
  const message = graphStore.use((s) => s.message);
  const log = graphStore.use((s) => s.log);
  const [showLog, setShowLog] = useState(false);
  return (
    <div className="graph-placeholder">
      {(status === "analyzing" || status === "loading") && <div className="loader" />}
      <p className={status === "error" ? "error" : ""}>{message || "Sem grafo para este projeto."}</p>
      {status === "error" && (
        <div className="row">
          <button className="btn" onClick={() => void runAnalysis()}>
            <Icon name="refresh" /> Tentar novamente
          </button>
          {log && (
            <button className="btn" onClick={() => setShowLog(!showLog)}>
              {showLog ? "Ocultar log" : "Ver log"}
            </button>
          )}
        </div>
      )}
      {status === "none" && (
        <button className="btn" onClick={() => void runAnalysis()}>
          <Icon name="refresh" /> Gerar grafo
        </button>
      )}
      {showLog && <pre className="log">{log}</pre>}
    </div>
  );
}
