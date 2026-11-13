import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrandMark, Icon } from "./Icons";
import { graphStore, type GraphStatus } from "../state/graph";
import { pickAndOpenProject, projectStore } from "../state/project";
import { uiStore } from "../state/ui";

const STATUS: Record<GraphStatus, { label: string; tone: string }> = {
  none: { label: "NO GRAPH", tone: "idle" },
  loading: { label: "LOADING", tone: "busy" },
  analyzing: { label: "ANALYZING", tone: "busy" },
  synced: { label: "GRAPH SYNCED", tone: "ok" },
  outdated: { label: "OUTDATED", tone: "warn" },
  error: { label: "GRAPH ERROR", tone: "error" },
  test: { label: "TEST GRAPH", tone: "warn" },
};

/** Barra superior minimalista: identidade, projeto, estado do grafo e comandos globais. */
export function TopNavigation() {
  const name = projectStore.use((s) => s.name);
  const root = projectStore.use((s) => s.root);
  const status = graphStore.use((s) => s.status);
  const message = graphStore.use((s) => s.message);
  const nodes = graphStore.use((s) => s.graph?.nodes.length ?? 0);
  const left = uiStore.use((s) => s.left);
  const rightOpen = uiStore.use((s) => s.rightOpen);
  const st = STATUS[status];
  const win = getCurrentWindow();

  return (
    <header className="topnav" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <BrandMark />
        <span className="brand-name" data-tauri-drag-region>
          Graph <b>Visuals</b>
        </span>
      </div>
      <span className="topnav-sep" />
      <button className="project-btn" onClick={() => void pickAndOpenProject()} title={root ?? "Abrir projeto"}>
        {name || "Abrir projeto"}
        <Icon name="chevronDown" size={12} />
      </button>
      {root && (
        <>
          <span className="topnav-sep" />
          <span className={`status-pill ${st.tone}`} title={message}>
            <i />
            {st.label}
          </span>
          {nodes > 0 && <span className="topnav-figure">{nodes.toLocaleString("pt-BR")} nodes</span>}
        </>
      )}

      <div className="topnav-center" data-tauri-drag-region>
        <button className="search-trigger" onClick={() => uiStore.set({ find: "files" })}>
          <Icon name="search" size={14} />
          <span>Buscar no projeto</span>
          <kbd>Ctrl</kbd>
          <kbd>P</kbd>
        </button>
      </div>

      <div className="topnav-actions">
        <button
          className={`icon-btn ${left !== "hidden" ? "on" : ""}`}
          title="Agentes (Ctrl+B)"
          onClick={() => uiStore.set({ left: left === "hidden" ? "rail" : "hidden" })}
        >
          <Icon name="panelLeft" />
        </button>
        <button
          className={`icon-btn ${rightOpen ? "on" : ""}`}
          title="Explorador do projeto (Ctrl+L)"
          onClick={() => uiStore.set({ rightOpen: !rightOpen })}
        >
          <Icon name="panelRight" />
        </button>
        <button className="icon-btn" title="Configurações (Ctrl+,)" onClick={() => uiStore.set({ settingsOpen: true })}>
          <Icon name="settings" />
        </button>
        <span className="topnav-sep" />
        <div className="window-controls">
          <button title="Minimizar" onClick={() => void win.minimize()}>
            <Icon name="minimize" size={14} />
          </button>
          <button title="Maximizar" onClick={() => void win.toggleMaximize()}>
            <Icon name="maximize" size={12} />
          </button>
          <button className="close" title="Fechar" onClick={() => void win.close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
