import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { openContextMenu } from "./ContextMenu";
import { fsListDir, type DirEntry } from "../lib/ipc";
import { baseName, pathKey, toRel } from "../lib/paths";
import { projectStore, toggleExpanded } from "../state/project";
import { settingsStore } from "../state/settings";
import { activityStore, isActive } from "../state/activity";
import { cancelEdit, commitEdit, confirmDelete, explorerStore, menuFor, moveInto, treeItemKey } from "../state/explorer";
import { gitStore } from "../state/git";
import type { GitChange } from "../lib/ipc";

const GIT_LABEL: Record<GitChange["status"], string> = {
  M: "Modificado",
  A: "Adicionado",
  D: "Excluído",
  R: "Renomeado",
  U: "Não rastreado",
  C: "Conflito",
};

export const gitLabel = (c: GitChange) => GIT_LABEL[c.status] + (c.staged ? " (staged)" : "");

/** Foca o primeiro item da árvore dentro de `scope`. */
export function focusFirstTreeItem(scope: HTMLElement) {
  scope.querySelector<HTMLElement>(".tree-item[data-depth]")?.focus();
}

/** Setas na árvore, como no VS Code. Retorna true se tratou a tecla. */
function treeArrowKey(e: React.KeyboardEvent<HTMLDivElement>, entry: DirEntry, open: boolean): boolean {
  const el = e.currentTarget;
  const tree = el.closest(".file-tree");
  if (!tree) return false;
  const items = [...tree.querySelectorAll<HTMLElement>(".tree-item[data-depth]")];
  const i = items.indexOf(el);
  const depth = Number(el.dataset.depth);
  const focus = (t: HTMLElement | undefined) => t?.focus();
  switch (e.key) {
    case "ArrowDown":
      focus(items[i + 1]);
      return true;
    case "ArrowUp":
      focus(items[i - 1]);
      return true;
    case "Home":
      focus(items[0]);
      return true;
    case "End":
      focus(items[items.length - 1]);
      return true;
    case "ArrowRight":
      if (!entry.isDir) return true;
      if (!open) toggleExpanded(entry.path);
      else if (items[i + 1] && Number(items[i + 1].dataset.depth) > depth) focus(items[i + 1]);
      return true;
    case "ArrowLeft":
      if (entry.isDir && open) {
        toggleExpanded(entry.path);
        return true;
      }
      for (let k = i - 1; k >= 0; k--) {
        if (Number(items[k].dataset.depth) < depth) {
          focus(items[k]);
          break;
        }
      }
      return true;
  }
  return false;
}

let suppressClick = false;

/** Pasta de destino sob o ponteiro: a pasta do item (ou a pasta que o contém) ou a raiz. */
function dropTarget(x: number, y: number): { el: HTMLElement; dir: string } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".tree-item[data-path], .file-tree");
  if (!el) return null;
  if (el.classList.contains("file-tree")) return { el, dir: el.dataset.root! };
  const path = el.dataset.path!;
  if (el.dataset.dir === "1") return { el, dir: path };
  const parent = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  return { el, dir: parent };
}

/** Arrastar por eventos de ponteiro (o drag nativo do HTML é interceptado pelo Tauri). */
function beginTreeDrag(e: React.PointerEvent, entry: DirEntry) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("input")) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;
  let marked: HTMLElement | null = null;
  const mark = (el: HTMLElement | null) => {
    if (marked === el) return;
    marked?.classList.remove("drop-target");
    el?.classList.add("drop-target");
    marked = el;
  };
  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      active = true;
      document.body.classList.add("dragging-file");
    }
    const t = dropTarget(ev.clientX, ev.clientY);
    // Só destaca pastas (ou a raiz); soltar sobre um arquivo vai para a pasta dele.
    mark(t && pathKey(t.dir) !== pathKey(entry.path) && t.el.dataset.dir !== "0" ? t.el : null);
  };
  const finish = (cancel: boolean, ev?: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    if (!active) return;
    document.body.classList.remove("dragging-file");
    mark(null);
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (cancel || !ev) return;
    const t = dropTarget(ev.clientX, ev.clientY);
    if (t) void moveInto(entry.path, t.dir);
  };
  const up = (ev: PointerEvent) => finish(false, ev);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

/** Árvore do sistema de arquivos real (independente do grafo). */
export function FileTree({ onOpenFile }: { onOpenFile: (absPath: string) => void }) {
  const root = projectStore.use((s) => s.root);
  if (!root) return null;
  return (
    <div className="file-tree" data-root={root} role="tree" aria-label="Arquivos do projeto" onContextMenu={(e) => openContextMenu(e, menuFor(null, onOpenFile))}>
      <DirChildren path={root} depth={0} onOpenFile={onOpenFile} />
    </div>
  );
}

function DirChildren({ path, depth, onOpenFile }: { path: string; depth: number; onOpenFile: (p: string) => void }) {
  const token = projectStore.use((s) => s.treeToken);
  const showHidden = settingsStore.use((s) => s.showHidden);
  const edit = explorerStore.use((s) => s.edit);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fsListDir(path)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [path, token]);

  const creating = edit && edit.kind !== "rename" && pathKey(edit.dir) === pathKey(path) ? edit.kind : null;
  if (error) return <div className="tree-error" style={{ paddingLeft: depth * 14 + 10 }}>{error}</div>;
  if (!entries) return null;
  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
  return (
    <>
      {creating && (
        <div className="tree-item editing" style={{ paddingLeft: depth * 14 + 10 }}>
          <span className="tree-chevron" />
          <Icon name={creating === "newFolder" ? "folder" : "file"} size={14} className="tree-icon" />
          <NameInput initial="" placeholder={creating === "newFolder" ? "Nome da pasta" : "Nome do arquivo (aceita a/b.ts)"} />
        </div>
      )}
      {visible.map((e) => (
        <TreeItem key={e.path} entry={e} depth={depth} onOpenFile={onOpenFile} />
      ))}
    </>
  );
}

/** Campo de nome dentro da árvore: Enter confirma, Esc cancela, sair do campo confirma. */
function NameInput({ initial, placeholder }: { initial: string; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    // Como no VS Code: ao renomear, seleciona o nome sem a extensão.
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const commit = async () => {
    if (busy.current) return;
    busy.current = true;
    const ok = await commitEdit(ref.current?.value ?? "");
    busy.current = false;
    if (!ok) ref.current?.focus();
  };
  return (
    <input
      ref={ref}
      className="tree-input"
      defaultValue={initial}
      placeholder={placeholder}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void commit();
        else if (e.key === "Escape") cancelEdit();
      }}
      onBlur={() => void commit()}
    />
  );
}

function TreeItem({ entry, depth, onOpenFile }: { entry: DirEntry; depth: number; onOpenFile: (p: string) => void }) {
  const key = pathKey(entry.path);
  const open = projectStore.use((s) => s.expanded.has(key));
  const revealed = projectStore.use((s) => (s.revealed ? pathKey(s.revealed) === key : false));
  const renaming = explorerStore.use((s) => s.edit?.kind === "rename" && pathKey(s.edit.target) === key);
  const root = projectStore.use((s) => s.root)!;
  const modified = projectStore.use((s) => s.modified);
  const isRepo = gitStore.use((s) => !!s.status?.isRepo);
  const byRel = gitStore.use((s) => s.byRel);
  const dirtyDirs = gitStore.use((s) => s.dirtyDirs);
  const ref = useRef<HTMLDivElement>(null);
  const rel = toRel(root, entry.path) ?? "";
  const relKey = rel.toLowerCase();
  const change = isRepo ? (entry.isDir ? undefined : byRel.get(relKey)) : undefined;
  const isModified = isRepo
    ? entry.isDir
      ? dirtyDirs.has(relKey) || byRel.has(relKey)
      : !!change
    : entry.isDir
      ? [...modified].some((m) => m.toLowerCase().startsWith(relKey + "/"))
      : modified.has(rel);
  // Re-renderiza a cada evento de atividade; o brilho some após o TTL.
  activityStore.use((s) => s.version);
  const active = !entry.isDir && isActive(rel);

  useEffect(() => {
    if (revealed) ref.current?.scrollIntoView({ block: "center" });
  }, [revealed]);

  return (
    <>
      <div
        ref={ref}
        tabIndex={0}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={entry.isDir ? open : undefined}
        aria-selected={revealed}
        data-depth={depth}
        data-path={entry.path}
        data-dir={entry.isDir ? "1" : "0"}
        onPointerDown={(e) => !renaming && beginTreeDrag(e, entry)}
        className={`tree-item ${entry.isDir ? "dir" : "file"} ${revealed ? "revealed" : ""} ${renaming ? "editing" : ""} ${
          isRepo && isModified ? `git-${change?.status ?? "dir"}` : ""
        }`}
        style={{ paddingLeft: depth * 14 + 10 }}
        title={entry.path}
        onClick={() => !renaming && !suppressClick && (entry.isDir ? toggleExpanded(entry.path) : onOpenFile(entry.path))}
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === "Enter") entry.isDir ? toggleExpanded(entry.path) : onOpenFile(entry.path);
          else if (treeArrowKey(e, entry, open)) {
            e.preventDefault();
            e.stopPropagation();
          } else treeItemKey(e, entry);
        }}
        onContextMenu={(e) => {
          ref.current?.focus();
          openContextMenu(e, menuFor(entry, onOpenFile));
        }}
      >
        <span className="tree-chevron">
          {entry.isDir && <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />}
        </span>
        <Icon name={entry.isDir ? (open ? "folderOpen" : "folder") : "file"} size={14} className="tree-icon" />
        {renaming ? <NameInput initial={baseName(entry.path)} /> : <span className="tree-name">{entry.name}</span>}
        {!renaming && change && !active ? (
          <span className="git-badge" title={gitLabel(change)}>
            {change.status}
          </span>
        ) : (
          !renaming &&
          (isModified || active) && (
            <span
              className={`mod-dot ${active ? "active" : ""}`}
              title={active ? "Gravado durante uma sessão de agente" : isRepo ? "Contém alterações não commitadas" : "Alterado nesta sessão"}
            />
          )
        )}
      </div>
      {open && entry.isDir && (
        <div role="group">
          <DirChildren path={entry.path} depth={depth + 1} onOpenFile={onOpenFile} />
        </div>
      )}
    </>
  );
}

/** Confirmação de exclusão (o item vai para a Lixeira, como no VS Code). */
export function DeleteConfirm() {
  const c = explorerStore.use((s) => s.confirmDelete);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (c) okRef.current?.focus();
  }, [c]);
  if (!c) return null;
  const cancel = () => explorerStore.set({ confirmDelete: null });
  return (
    <div className="modal-backdrop" onPointerDown={cancel}>
      <div
        className="confirm-dialog glass-strong"
        role="alertdialog"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <h3>
          Excluir {c.isDir ? "a pasta" : "o arquivo"} “{baseName(c.path)}”{c.isDir ? " e todo o seu conteúdo" : ""}?
        </h3>
        <p>O item será movido para a Lixeira e pode ser restaurado de lá.</p>
        <div className="confirm-actions">
          <button className="btn" onClick={cancel}>
            Cancelar
          </button>
          <button ref={okRef} className="btn btn-danger" onClick={() => void confirmDelete()}>
            Mover para a Lixeira
          </button>
        </div>
      </div>
    </div>
  );
}
