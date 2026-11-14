import { useDeferredValue, useMemo, useState } from "react";
import { FileTree } from "./FileTree";
import { openContextMenu } from "./ContextMenu";
import { menuFor } from "../state/explorer";
import { Icon } from "./Icons";
import { matchPath } from "../lib/fuzzy";
import { joinRel, toRel } from "../lib/paths";
import { projectStore } from "../state/project";
import { representativeNode, sceneApi, selectNode } from "../state/graph";
import { editorStore, openInEditor, showEditor } from "../state/editor";
import { uiStore } from "../state/ui";

/** Abre o arquivo no editor e o localiza no grafo, quando houver nó. */
export function openFileAndLocate(absPath: string) {
  const root = projectStore.get().root;
  openInEditor(absPath);
  const rel = root ? toRel(root, absPath) : null;
  const idx = rel ? representativeNode(rel) : null;
  if (idx !== null) {
    selectNode(idx);
    sceneApi()?.focusNodes([idx]);
  }
}

/** Lateral direita: estrutura real de diretórios do projeto. */
export function ProjectExplorer() {
  const open = uiStore.use((s) => s.rightOpen);
  const root = projectStore.use((s) => s.root);
  const name = projectStore.use((s) => s.name);
  const index = projectStore.use((s) => s.index);
  const modified = projectStore.use((s) => s.modified);
  const editorPath = editorStore.use((s) => s.openPath);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"tree" | "modified">("tree");
  const q = useDeferredValue(query.trim());

  const results = useMemo(() => {
    if (!q) return [];
    const out: { rel: string; score: number }[] = [];
    for (const e of index) {
      if (e.isDir) continue;
      const m = matchPath(q, e.rel);
      if (m) out.push({ rel: e.rel, score: m.score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 80);
  }, [q, index]);

  if (!open) return null;
  return (
    <aside className="explorer">
      <header className="explorer-head">
        <div>
          <span className="eyebrow">Projeto</span>
          <h2 title={root ?? ""}>{name || "—"}</h2>
        </div>
        <span className="spacer" />
        <button className="icon-btn" title="Editor de código" disabled={!editorPath} onClick={showEditor}>
          <Icon name="code" />
        </button>
        <button
          className="icon-btn"
          title="Recolher todos"
          onClick={() => projectStore.set({ expanded: new Set(), revealed: null })}
        >
          <Icon name="compact" />
        </button>
        <button className="icon-btn" title="Ocultar (Ctrl+L)" onClick={() => uiStore.set({ rightOpen: false })}>
          <Icon name="panelRight" />
        </button>
      </header>

      {root ? (
        <>
          <div className="explorer-search">
            <Icon name="search" size={14} />
            <input
              value={query}
              placeholder="Pesquisar arquivos"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
          </div>
          <div className="tabs-mini">
            <button className={tab === "tree" ? "on" : ""} onClick={() => setTab("tree")}>
              Árvore
            </button>
            <button className={tab === "modified" ? "on" : ""} onClick={() => setTab("modified")}>
              Modificados <span className="count">{modified.size}</span>
            </button>
          </div>
          <div className="explorer-body">
            {q ? (
              <FlatList rels={results.map((r) => r.rel)} root={root} empty="Nenhum arquivo encontrado." />
            ) : tab === "modified" ? (
              <FlatList rels={[...modified].sort()} root={root} empty="Nenhum arquivo alterado desde a abertura." />
            ) : (
              <FileTree onOpenFile={openFileAndLocate} />
            )}
          </div>
        </>
      ) : (
        <div className="panel-empty">Nenhum projeto aberto.</div>
      )}
    </aside>
  );
}

function FlatList({ rels, root, empty }: { rels: string[]; root: string; empty: string }) {
  if (!rels.length) return <div className="panel-empty">{empty}</div>;
  return (
    <ul className="flat-list">
      {rels.map((rel) => {
        const slash = rel.lastIndexOf("/");
        return (
          <li
            key={rel}
            onClick={() => openFileAndLocate(joinRel(root, rel))}
            onContextMenu={(e) => openContextMenu(e, menuFor({ path: joinRel(root, rel), isDir: false }, openFileAndLocate))}
            title={rel}
          >
            <Icon name="file" size={14} />
            <span className="name">{rel.slice(slash + 1)}</span>
            <span className="dir">{rel.slice(0, Math.max(slash, 0))}</span>
          </li>
        );
      })}
    </ul>
  );
}
