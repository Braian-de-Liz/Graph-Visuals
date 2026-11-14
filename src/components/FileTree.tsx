import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { openContextMenu } from "./ContextMenu";
import { fsListDir, type DirEntry } from "../lib/ipc";
import { baseName, pathKey, toRel } from "../lib/paths";
import { projectStore, toggleExpanded } from "../state/project";
import { settingsStore } from "../state/settings";
import { activityStore, isActive } from "../state/activity";
import { cancelEdit, commitEdit, confirmDelete, explorerStore, menuFor, treeItemKey } from "../state/explorer";

/** Árvore do sistema de arquivos real (independente do grafo). */
export function FileTree({ onOpenFile }: { onOpenFile: (absPath: string) => void }) {
  const root = projectStore.use((s) => s.root);
  if (!root) return null;
  return (
    <div className="file-tree" onContextMenu={(e) => openContextMenu(e, menuFor(null, onOpenFile))}>
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
  const ref = useRef<HTMLDivElement>(null);
  const rel = toRel(root, entry.path) ?? "";
  const isModified = entry.isDir
    ? [...modified].some((m) => m.toLowerCase().startsWith(rel.toLowerCase() + "/"))
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
        className={`tree-item ${entry.isDir ? "dir" : "file"} ${revealed ? "revealed" : ""} ${renaming ? "editing" : ""}`}
        style={{ paddingLeft: depth * 14 + 10 }}
        title={entry.path}
        onClick={() => !renaming && (entry.isDir ? toggleExpanded(entry.path) : onOpenFile(entry.path))}
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === "Enter") entry.isDir ? toggleExpanded(entry.path) : onOpenFile(entry.path);
          else treeItemKey(e, entry);
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
        {!renaming && (isModified || active) && (
          <span className={`mod-dot ${active ? "active" : ""}`} title={active ? "Gravado durante uma sessão de agente" : "Alterado nesta sessão"} />
        )}
      </div>
      {open && entry.isDir && <DirChildren path={entry.path} depth={depth + 1} onOpenFile={onOpenFile} />}
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
