import { useMemo, useState } from "react";
import { FileTree } from "./FileTree";
import { openContextMenu } from "./ContextMenu";
import { menuFor, startCreate } from "../state/explorer";
import { Icon } from "./Icons";
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
  const modified = projectStore.use((s) => s.modified);
  const editorPath = editorStore.use((s) => s.openPath);
  const git = gitStore.use((s) => s.status);
  const isRepo = !!git?.isRepo;
  const changes = useMemo(() => (git?.changes ?? []).slice().sort((a, b) => a.rel.localeCompare(b.rel)), [git]);
  const [tab, setTab] = useState<"tree" | "modified">("tree");

  /** Novo arquivo/pasta pelo cabeçalho: cria na raiz, com a árvore visível. */
  const create = (kind: "newFile" | "newFolder") => {
    if (!root) return;
    setTab("tree");
    startCreate(kind, root);
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
          <div className="tabs-mini" role="tablist">
            <button role="tab" aria-selected={tab === "tree"} className={tab === "tree" ? "on" : ""} onClick={() => setTab("tree")}>
              Árvore
            </button>
            <button role="tab" aria-selected={tab === "modified"} className={tab === "modified" ? "on" : ""} onClick={() => setTab("modified")}>
              {isRepo ? "Alterações" : "Modificados"} <span className="count">{isRepo ? changes.length : modified.size}</span>
            </button>
          </div>
          <div className="explorer-body">
            {tab === "modified" && isRepo ? (
              <FlatList
                rels={changes.map((c) => c.rel)}
                changes={changes}
                root={root}
                empty="Nenhuma alteração desde o último commit."
              />
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

function FlatList(props: { rels: string[]; root: string; empty: string; changes?: GitChange[] }) {
  const { rels, root, empty, changes } = props;
  if (!rels.length) return <div className="panel-empty">{empty}</div>;
  const move = (el: HTMLElement, dir: 1 | -1) => {
    const next = (dir > 0 ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
    next?.focus();
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
            <span className="name">{rel.slice(slash + 1)}</span>
            <span className="dir">{rel.slice(0, Math.max(slash, 0))}</span>
            {change && <span className="git-badge">{change.status}</span>}
          </li>
        );
      })}
    </ul>
  );
}
