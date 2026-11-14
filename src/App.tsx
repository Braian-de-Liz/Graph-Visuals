import { useEffect, useRef } from "react";
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
import { uiStore } from "./state/ui";
import { editorStore, showEditor } from "./state/editor";
import { baseName } from "./lib/paths";
import { installKeybindings, restoreZoom } from "./lib/keybindings";
import { restoreLastProject } from "./state/project";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";

const RAIL = 68;

/** ApplicationShell: barra superior, laterais, região central e camadas flutuantes. */
export default function App() {
  const left = uiStore.use((s) => s.left);
  const leftWidth = uiStore.use((s) => s.leftWidth);
  const rightOpen = uiStore.use((s) => s.rightOpen);
  const rightWidth = uiStore.use((s) => s.rightWidth);
  const bottomHeight = uiStore.use((s) => s.bottomHeight);
  const bottomCollapsed = uiStore.use((s) => s.bottomCollapsed);
  const bottomExpanded = uiStore.use((s) => s.bottomExpanded);
  const rightTopId = sessionsStore.use((s) => s.rightTopId);
  const rightBottomId = sessionsStore.use((s) => s.rightBottomId);
  const leftTopId = sessionsStore.use((s) => s.leftTopId);
  const leftBottomId = sessionsStore.use((s) => s.leftBottomId);
  const centerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);

  useEffect(() => {
    restoreZoom();
    restoreLastProject();
    return installKeybindings();
  }, []);

  const leftColumn = left === "expanded" || !!leftTopId || !!leftBottomId;
  const leftW = left === "hidden" ? 0 : leftColumn ? RAIL + leftWidth : RAIL;
  const rightW = rightOpen || rightTopId || rightBottomId ? rightWidth : 0;
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
              onStart={() => (dragStart.current = leftWidth)}
              onDrag={(d) => uiStore.set({ leftWidth: clamp(dragStart.current + d, 280, 900) })}
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
              onStart={() => (dragStart.current = rightWidth)}
              onDrag={(d) => uiStore.set({ rightWidth: clamp(dragStart.current - d, 220, 900) })}
            />
          )}
          <RightDock />
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
  const toast = uiStore.use((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast glass-strong ${toast.tone}`}>
      {toast.text}
    </div>
  );
}
