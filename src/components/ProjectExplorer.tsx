import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { FileTree, focusFirstTreeItem } from "./FileTree";
import { openContextMenu } from "./ContextMenu";
import { menuFor, startCreate } from "../state/explorer";
import { Icon } from "./Icons";
import { matchPath } from "../lib/fuzzy";
import { joinRel, toRel } from "../lib/paths";
import { projectStore, refreshProject } from "../state/project";
import { representativeNode, sceneApi, selectNode } from "../state/graph";
import { editorStore, openInEditor, showEditor } from "../state/editor";
import { uiStore } from "../state/ui";
import { gitStore, refreshGit } from "../state/git";
import { gitLabel } from "./FileTree";
import type { GitChange } from "../lib/ipc";

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
  const git = gitStore.use((s) => s.status);
  const isRepo = !!git?.isRepo;
  const changes = useMemo(() => (git?.changes ?? []).slice().sort((a, b) => a.rel.localeCompare(b.rel)), [git]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"tree" | "modified">("tree");
  const q = useDeferredValue(query.trim());
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!q) return [];
    const out: { rel: string; score: number; positions: number[] }[] = [];
    for (const e of index) {
      if (e.isDir) continue;
      const m = matchPath(q, e.rel);
      if (m) out.push({ rel: e.rel, score: m.score, positions: m.positions });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 80);
  }, [q, index]);

  /** Novo arquivo/pasta pelo cabeçalho: cria na raiz, com a árvore visível. */
  const create = (kind: "newFile" | "newFolder") => {
    if (!root) return;
    setQuery("");
    setTab("tree");
    startCreate(kind, root);
  };

  const focusBody = () => {
    const body = bodyRef.current;
    if (!body) return;
    const first = body.querySelector<HTMLElement>(".flat-list li");
    if (first) first.focus();
    else focusFirstTreeItem(body);
  };

  if (!open) return null;
  return (
    <aside className="explorer">
      <header className="explorer-head">
        <div>
          <span className="eyebrow">Projeto</span>
          <h2 title={root ?? ""}>{name || "—"}</h2>
        </div>
        <span className="spacer" />
        <button className="icon-btn" title="Novo arquivo" disabled={!root} onClick={() => create("newFile")}>
          <Icon name="fileAdd" />
        </button>
        <button className="icon-btn" title="Nova pasta" disabled={!root} onClick={() => create("newFolder")}>
          <Icon name="folderAdd" />
        </button>
        <button
          className="icon-btn"
          title="Atualizar"
          disabled={!root}
          onClick={() => {
            refreshProject();
            void refreshGit();
          }}
        >
          <Icon name="refresh" />
        </button>
        <button
          className="icon-btn"
          title="Recolher todos"
          onClick={() => projectStore.set({ expanded: new Set(), revealed: null })}
        >
          <Icon name="compact" />
        </button>
        <button className="icon-btn" title="Editor de código" disabled={!editorPath} onClick={showEditor}>
          <Icon name="code" />
        </button>
        <button className="icon-btn" title="Ocultar explorador" onClick={() => uiStore.set({ rightOpen: false })}>
          <Icon name="panelRight" />
        </button>
      </header>

      {root ? (
        <>
          <div className="explorer-search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              value={query}
              placeholder="Pesquisar arquivos  (↓ para os resultados)"
              spellCheck={false}
              aria-label="Pesquisar arquivos"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                else if (e.key === "ArrowDown") focusBody();
                else if (e.key === "Enter" && results[0]) openFileAndLocate(joinRel(root, results[0].rel));
                else return;
                e.preventDefault();
              }}
            />
          </div>
          <div className="tabs-mini" role="tablist">
            <button role="tab" aria-selected={tab === "tree"} className={tab === "tree" ? "on" : ""} onClick={() => setTab("tree")}>
              Árvore
            </button>
            <button role="tab" aria-selected={tab === "modified"} className={tab === "modified" ? "on" : ""} onClick={() => setTab("modified")}>
              {isRepo ? "Alterações" : "Modificados"} <span className="count">{isRepo ? changes.length : modified.size}</span>
            </button>
          </div>
          <div className="explorer-body" ref={bodyRef}>
            {q ? (
              <FlatList
                rels={results.map((r) => r.rel)}
                positions={results.map((r) => r.positions)}
                root={root}
                empty="Nenhum arquivo encontrado."
                onExitTop={() => searchRef.current?.focus()}
              />
            ) : tab === "modified" && isRepo ? (
              <FlatList
                rels={changes.map((c) => c.rel)}
                changes={changes}
                root={root}
                empty="Nenhuma alteração desde o último commit."
                onExitTop={() => searchRef.current?.focus()}
              />
            ) : tab === "modified" ? (
              <FlatList
                rels={[...modified].sort()}
                root={root}
                empty="Nenhum arquivo alterado desde a abertura."
                onExitTop={() => searchRef.current?.focus()}
              />
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

/** Trecho de `text` com os caracteres em `positions` (relativos a `offset`) destacados. */
function Highlighted({ text, offset, positions }: { text: string; offset: number; positions?: number[] }): ReactNode {
  if (!positions?.length) return text;
  const set = new Set(positions.map((p) => p - offset));
  const out: ReactNode[] = [];
  let buf = "";
  let marked = false;
  const flush = (k: number) => {
    if (!buf) return;
    out.push(marked ? <mark key={k}>{buf}</mark> : buf);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== marked) {
      flush(i);
      marked = m;
    }
    buf += text[i];
  }
  flush(text.length);
  return out;
}

function FlatList(props: {
  rels: string[];
  root: string;
  empty: string;
  changes?: GitChange[];
  positions?: number[][];
  onExitTop?: () => void;
}) {
  const { rels, root, empty, changes, positions, onExitTop } = props;
  if (!rels.length) return <div className="panel-empty">{empty}</div>;
  const move = (el: HTMLElement, dir: 1 | -1) => {
    const next = (dir > 0 ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
    if (next) next.focus();
    else if (dir < 0) onExitTop?.();
  };
  return (
    <ul className="flat-list" role="listbox" aria-label="Arquivos">
      {rels.map((rel, i) => {
        const slash = rel.lastIndexOf("/");
        const change = changes?.[i];
        // Arquivo excluído não existe mais no disco: não há o que abrir.
        const gone = change?.status === "D";
        const abs = joinRel(root, rel);
        return (
          <li
            key={rel}
            role="option"
            aria-selected={false}
            tabIndex={0}
            className={`${change ? `git-${change.status}` : ""} ${gone ? "gone" : ""}`}
            onClick={() => !gone && openFileAndLocate(abs)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") move(e.currentTarget, 1);
              else if (e.key === "ArrowUp") move(e.currentTarget, -1);
              else if (e.key === "Enter" && !gone) openFileAndLocate(abs);
              else return;
              e.preventDefault();
            }}
            onContextMenu={(e) => (gone ? e.preventDefault() : openContextMenu(e, menuFor({ path: abs, isDir: false }, openFileAndLocate)))}
            title={change ? `${rel} — ${gitLabel(change)}` : rel}
          >
            <Icon name="file" size={14} />
            <span className="name">
              <Highlighted text={rel.slice(slash + 1)} offset={slash + 1} positions={positions?.[i]} />
            </span>
            <span className="dir">
              <Highlighted text={rel.slice(0, Math.max(slash, 0))} offset={0} positions={positions?.[i]} />
            </span>
            {change && <span className="git-badge">{change.status}</span>}
          </li>
        );
      })}
    </ul>
  );
}
