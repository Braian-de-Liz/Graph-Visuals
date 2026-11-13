import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { fsListDir, type DirEntry } from "../lib/ipc";
import { pathKey, toRel } from "../lib/paths";
import { projectStore, toggleExpanded } from "../state/project";
import { settingsStore } from "../state/settings";
import { activityStore, isActive } from "../state/activity";

/** Árvore do sistema de arquivos real (independente do grafo). */
export function FileTree({ onOpenFile }: { onOpenFile: (absPath: string) => void }) {
  const root = projectStore.use((s) => s.root);
  if (!root) return null;
  return (
    <div className="file-tree">
      <DirChildren path={root} depth={0} onOpenFile={onOpenFile} />
    </div>
  );
}

function DirChildren({ path, depth, onOpenFile }: { path: string; depth: number; onOpenFile: (p: string) => void }) {
  const token = projectStore.use((s) => s.treeToken);
  const showHidden = settingsStore.use((s) => s.showHidden);
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

  if (error) return <div className="tree-error" style={{ paddingLeft: depth * 14 + 10 }}>{error}</div>;
  if (!entries) return null;
  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
  return (
    <>
      {visible.map((e) => (
        <TreeItem key={e.path} entry={e} depth={depth} onOpenFile={onOpenFile} />
      ))}
    </>
  );
}

function TreeItem({ entry, depth, onOpenFile }: { entry: DirEntry; depth: number; onOpenFile: (p: string) => void }) {
  const key = pathKey(entry.path);
  const open = projectStore.use((s) => s.expanded.has(key));
  const revealed = projectStore.use((s) => (s.revealed ? pathKey(s.revealed) === key : false));
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
        className={`tree-item ${entry.isDir ? "dir" : "file"} ${revealed ? "revealed" : ""}`}
        style={{ paddingLeft: depth * 14 + 10 }}
        title={entry.path}
        onClick={() => (entry.isDir ? toggleExpanded(entry.path) : onOpenFile(entry.path))}
      >
        <span className="tree-chevron">
          {entry.isDir && <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />}
        </span>
        <Icon name={entry.isDir ? (open ? "folderOpen" : "folder") : "file"} size={14} className="tree-icon" />
        <span className="tree-name">{entry.name}</span>
        {(isModified || active) && (
          <span className={`mod-dot ${active ? "active" : ""}`} title={active ? "Gravado durante uma sessão de agente" : "Alterado nesta sessão"} />
        )}
      </div>
      {open && entry.isDir && <DirChildren path={entry.path} depth={depth + 1} onOpenFile={onOpenFile} />}
    </>
  );
}
