import { useEffect, useRef } from "react";
import { TopNavigation } from "./components/TopNavigation";
import { AgentSidebar } from "./components/AgentSidebar";
import { GraphViewport } from "./components/GraphViewport";
import { PrimaryAgentWorkspace } from "./components/PrimaryAgentWorkspace";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { QuickSpatialFind } from "./components/QuickSpatialFind";
import { FloatingCodeEditor } from "./components/FloatingCodeEditor";
import { ApplicationSettings } from "./components/ApplicationSettings";
import { Splitter } from "./components/Splitter";
import { Icon } from "./components/Icons";
import { uiStore } from "./state/ui";
import { editorStore, showEditor } from "./state/editor";
import { baseName } from "./lib/paths";
import { installKeybindings, restoreZoom } from "./lib/keybindings";
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
  const centerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);

  useEffect(() => {
    restoreZoom();
    return installKeybindings();
  }, []);

  const leftW = left === "hidden" ? 0 : left === "rail" ? RAIL : RAIL + leftWidth;
  const rightW = rightOpen ? rightWidth : 0;
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
          {left === "expanded" && (
            <Splitter
              axis="x"
              className="edge-right"
              onStart={() => (dragStart.current = leftWidth)}
              onDrag={(d) => uiStore.set({ leftWidth: clamp(dragStart.current + d, 280, 720) })}
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
          {rightOpen && (
            <Splitter
              axis="x"
              className="edge-left"
              onStart={() => (dragStart.current = rightWidth)}
              onDrag={(d) => uiStore.set({ rightWidth: clamp(dragStart.current - d, 220, 640) })}
            />
          )}
          <ProjectExplorer />
        </div>

        <FloatingCodeEditor />
        <EditorPill />
      </div>
      <QuickSpatialFind />
      <ApplicationSettings />
      <KeyboardShortcuts />
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
