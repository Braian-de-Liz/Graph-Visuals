import { useEffect, useRef, useState } from "react";
import { TopNavigation } from "./components/TopNavigation";
import { AgentSidebar } from "./components/AgentSidebar";
import { GraphViewport } from "./components/GraphViewport";
import { PrimaryAgentWorkspace } from "./components/PrimaryAgentWorkspace";
import { RightDock } from "./components/RightDock";
import { DropOverlay } from "./components/DropOverlay";
import { ContextMenu } from "./components/ContextMenu";
import { DeleteConfirm } from "./components/FileTree";
import { sessionsStore } from "./state/sessions";
import { QuickSpatialFind } from "./components/QuickSpatialFind";
import { FloatingCodeEditor } from "./components/FloatingCodeEditor";
import { ApplicationSettings } from "./components/ApplicationSettings";
import { Splitter } from "./components/Splitter";
import { Icon } from "./components/Icons";
import { dismissToast, uiStore } from "./state/ui";
import { editorStore, showEditor } from "./state/editor";
import { baseName } from "./lib/paths";
import { installKeybindings, restoreZoom } from "./lib/keybindings";
import { restoreLastProject } from "./state/project";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { installCloseGuard } from "./state/lifecycle";

const RAIL = 68;
/** Largura mínima reservada à região central (grafo e painel inferior). */
const CENTER_MIN = 440;

/** ApplicationShell: barra superior, laterais, região central e camadas flutuantes. */
export default function App() {
  const left = uiStore.use((s) => s.left);
  const leftWidth = uiStore.use((s) => s.leftWidth);
  const rightOpen = uiStore.use((s) => s.rightOpen);
  const rightWidth = uiStore.use((s) => s.rightWidth);
  const rightHidden = uiStore.use((s) => s.rightHidden);
  const railHidden = uiStore.use((s) => s.railHidden);
  const columnHidden = uiStore.use((s) => s.columnHidden);
  const bottomHeight = uiStore.use((s) => s.bottomHeight);
  const bottomCollapsed = uiStore.use((s) => s.bottomCollapsed);
  const bottomExpanded = uiStore.use((s) => s.bottomExpanded);
  const rightTopId = sessionsStore.use((s) => s.rightTopId);
  const rightBottomId = sessionsStore.use((s) => s.rightBottomId);
  const leftTopId = sessionsStore.use((s) => s.leftTopId);
  const leftBottomId = sessionsStore.use((s) => s.leftBottomId);
  const centerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);
  const [winWidth, setWinWidth] = useState(window.innerWidth);

  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    restoreZoom();
    restoreLastProject();
    const unKeys = installKeybindings();
    const unClose = installCloseGuard();
    return () => {
      unKeys();
      unClose();
    };
  }, []);

  const leftColumn = !columnHidden && (left === "expanded" || !!leftTopId || !!leftBottomId);
  const rail = left === "hidden" || railHidden ? 0 : RAIL;
  // As laterais cedem largura em janelas estreitas para a região central não
  // sumir. As larguras salvas não mudam: voltam ao alargar a janela.
  const room = Math.max(winWidth - rail - CENTER_MIN, 0);
  let colW = left !== "hidden" && leftColumn ? leftWidth : 0;
  let rightW = !rightHidden && (rightOpen || rightTopId || rightBottomId) ? rightWidth : 0;
  if (colW + rightW > room) {
    const k = room / (colW + rightW);
    colW = Math.floor(colW * k);
    rightW = Math.floor(rightW * k);
  }
  const leftW = rail + colW;
  const bottom = bottomCollapsed ? "40px" : bottomExpanded ? "72%" : `${bottomHeight}px`;

  return (
    <div
      className="shell"
      style={{ ["--left-w" as string]: `${leftW}px`, ["--right-w" as string]: `${rightW}px`, ["--bottom-h" as string]: bottom }}
    >
      <div className="ambient-bg" />
      <TopNavigation />
      <div className="workspace">
        <div className="side side-left" style={{ width: leftW }}>
          <AgentSidebar />
          {left !== "hidden" && leftColumn && (
            <Splitter
              axis="x"
              className="edge-right"
              onStart={() => (dragStart.current = colW)}
              onDrag={(d) => uiStore.set({ leftWidth: clamp(dragStart.current + d, 280, Math.min(900, room - rightW)) })}
            />
          )}
        </div>

        <div className="center" ref={centerRef}>
          <GraphViewport />
          {!bottomCollapsed && !bottomExpanded && (
            <Splitter
              axis="y"
              onStart={() => (dragStart.current = bottomHeight)}
              onDrag={(d) => {
                const max = (centerRef.current?.clientHeight ?? 800) - 160;
                uiStore.set({ bottomHeight: clamp(dragStart.current - d, 200, max) });
              }}
            />
          )}
          <div className="center-bottom" style={{ height: bottom }}>
            <PrimaryAgentWorkspace />
          </div>
        </div>

        <div className="side side-right" style={{ width: rightW }}>
          {rightW > 0 && (
            <Splitter
              axis="x"
              className="edge-left"
              onStart={() => (dragStart.current = rightW)}
              onDrag={(d) => uiStore.set({ rightWidth: clamp(dragStart.current - d, 220, Math.min(900, room - colW)) })}
            />
          )}
          {!rightHidden && <RightDock />}
        </div>

        <FloatingCodeEditor />
        <EditorPill />
      </div>
      <QuickSpatialFind />
      <ApplicationSettings />
      <KeyboardShortcuts />
      <DropOverlay />
      <ContextMenu />
      <DeleteConfirm />
      <ConfirmDialog />
      <ChordHint />
      <Toast />
    </div>
  );
}

/** Indica a primeira tecla de uma sequência (Ctrl+K …), como a barra de status do VS Code. */
function ChordHint() {
  const chord = uiStore.use((s) => s.chord);
  if (!chord) return null;
  return <div className="chord-hint glass-strong">({chord}) aguardando a segunda tecla…</div>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Editor recolhido: atalho para restaurá-lo sem perder o estado. */
function EditorPill() {
  const path = editorStore.use((s) => s.openPath);
  const visible = editorStore.use((s) => s.visible);
  const dirty = editorStore.use((s) => s.dirty);
  if (!path || visible) return null;
  return (
    <button className="editor-pill glass" onClick={showEditor} title="Mostrar editor">
      <Icon name="code" className="arc" />
      {baseName(path)}
      {dirty && <span className="dirty-dot" />}
    </button>
  );
}

function Toast() {
  const toasts = uiStore.use((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass-strong ${t.tone}`}>
          <span>{t.text}</span>
          <button className="toast-close" title="Dispensar" aria-label="Dispensar aviso" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}