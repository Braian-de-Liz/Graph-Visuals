import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrandMark, Icon } from "./Icons";
import { BranchPicker } from "./BranchPicker";
import { GraphStatusPill } from "./GraphStatus";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import { graphStore } from "../state/graph";
import { openProject, pickAndOpenProject, projectStore } from "../state/project";
import { settingsStore } from "../state/settings";
import { toggleExplorer, uiStore } from "../state/ui";
import { revealInOs } from "../lib/ipc";
import { baseName, pathKey } from "../lib/paths";
import { ago, useDismiss } from "../lib/useDismiss";

/** Encurta um caminho pela esquerda: "…\\Desktop\\projeto". */
function shortPath(p: string, max = 42) {
  return p.length <= max ? p : "…" + p.slice(p.length - max + 1);
}

/** Menu do botão do projeto: recentes, abrir pasta, revelar. */
function openProjectMenu(anchor: HTMLElement) {
  const root = projectStore.get().root;
  const recent = settingsStore.get().recentProjects.filter((p) => !root || pathKey(p) !== pathKey(root));
  const items: MenuItem[] = [];
  for (const p of recent) items.push({ label: baseName(p), hint: shortPath(p.slice(0, -baseName(p).length - 1)), run: () => void openProject(p) });
  if (recent.length) items.push("separator");
  items.push({ label: "Abrir pasta…", hint: "Ctrl+O", run: () => void pickAndOpenProject() });
  if (root) items.push({ label: "Revelar no Explorador de Arquivos", run: () => void revealInOs(root) });
  if (recent.length) {
    items.push("separator");
    items.push({ label: "Limpar recentes", run: () => settingsStore.set({ recentProjects: root ? [root] : [] }) });
  }
  const r = anchor.getBoundingClientRect();
  openContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} }, items);
}
/** Barra superior minimalista: identidade, projeto, estado do grafo e comandos globais. */
export function TopNavigation() {
  const name = projectStore.use((s) => s.name);
  const root = projectStore.use((s) => s.root);
  const nodes = graphStore.use((s) => s.graph?.nodes.length ?? 0);
  const left = uiStore.use((s) => s.left);
  const rightOpen = uiStore.use((s) => s.rightOpen && !s.rightHidden);
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const w = getCurrentWindow();
    const sync = () => void w.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const un = w.onResized(sync);
    return () => void un.then((f) => f());
  }, []);

  return (
    <header className="topnav" data-tauri-drag-region>
      <div className="topnav-left" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <BrandMark />
          <span className="brand-name" data-tauri-drag-region>
            Graph <b>Visuals</b>
          </span>
        </div>
        <span className="topnav-sep" data-tauri-drag-region />
        <button
          className="project-btn"
          aria-haspopup="menu"
          onClick={(e) => openProjectMenu(e.currentTarget)}
          title={root ? `${root} · recentes e abrir pasta` : "Abrir projeto"}
        >
          {name || "Abrir projeto"}
          <Icon name="chevronDown" size={12} />
        </button>
        {root && (
          <>
            <BranchPicker />
            <span className="topnav-sep" data-tauri-drag-region />
            <GraphStatusPill />
            {nodes > 0 && <span className="topnav-figure" data-tauri-drag-region>{nodes.toLocaleString("pt-BR")} nodes</span>}
          </>
        )}
      </div>

      <div className="topnav-center" data-tauri-drag-region>
        <button className="search-trigger" onClick={() => uiStore.set({ find: "files" })}>
          <Icon name="search" size={14} />
          <span>Buscar no projeto</span>
          <kbd>Ctrl</kbd>
          <kbd>P</kbd>
        </button>
      </div>

      <div className="topnav-actions" data-tauri-drag-region>
        <button
          className={`icon-btn ${left !== "hidden" ? "on" : ""}`}
          title="Agentes (Ctrl+B)"
          onClick={() => uiStore.set({ left: left === "hidden" ? "rail" : "hidden" })}
        >
          <Icon name="panelLeft" />
        </button>
        <button
          className={`icon-btn ${rightOpen ? "on" : ""}`}
          title="Explorador do projeto (Ctrl+L alterna a lateral direita)"
          onClick={toggleExplorer}
        >
          <Icon name="panelRight" />
        </button>
        <NoticesButton />
        <button className="icon-btn" title="Configurações (Ctrl+,)" onClick={() => uiStore.set({ settingsOpen: true })}>
          <Icon name="settings" />
        </button>
        <span className="topnav-sep" data-tauri-drag-region />
        <div className="window-controls">
          <button title="Minimizar" onClick={() => void win.minimize()}>
            <Icon name="minimize" size={14} />
          </button>
          <button title={maximized ? "Restaurar" : "Maximizar"} onClick={() => void win.toggleMaximize()}>
            <Icon name={maximized ? "restore" : "maximize"} size={12} />
          </button>
          <button className="close" title="Fechar" onClick={() => void win.close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

/** Histórico dos avisos da sessão (aparece depois do primeiro aviso). */
function NoticesButton() {
  const notices = uiStore.use((s) => s.notices);
  const unseen = uiStore.use((s) => s.unseenErrors);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open);
  if (!notices.length) return null;
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`icon-btn ${open ? "on" : ""}`}
        title={unseen ? `${unseen} erro(s) não visto(s)` : "Avisos recentes"}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          uiStore.set({ unseenErrors: 0 });
        }}
      >
        <Icon name="bell" />
        {unseen > 0 && <span className="notice-badge">{unseen > 9 ? "9+" : unseen}</span>}
      </button>
      {open && (
        <div className="popover glass-strong notices-panel" role="dialog" aria-label="Avisos recentes">
          <div className="popover-head">
            <strong>Avisos recentes</strong>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => (uiStore.set({ notices: [] }), setOpen(false))}>
              Limpar
            </button>
          </div>
          <ul className="notices-list">
            {notices.map((n) => (
              <li key={n.id} className={n.tone}>
                <span className="notice-dot" />
                <span className="notice-text">{n.text}</span>
                <time>{ago(n.at)}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}