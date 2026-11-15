import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";
import { createBranch, gitStore, loadBranches, switchBranch } from "../state/git";

type Row = { kind: "branch"; name: string; remote: boolean; current: boolean } | { kind: "create"; name: string };

/** Botão da branch atual na barra superior, com lista para trocar ou criar branch. */
export function BranchPicker() {
  const status = gitStore.use((s) => s.status);
  const switching = gitStore.use((s) => s.switching);
  const [open, setOpen] = useState(false);
  if (!status?.isRepo) return null;

  const label = status.branch || (status.detached ? `(${status.detached})` : "HEAD");
  const sync = [status.ahead ? `↑${status.ahead}` : "", status.behind ? `↓${status.behind}` : ""].filter(Boolean).join(" ");
  const title = status.branch
    ? `Branch ${status.branch}${status.upstream ? ` → ${status.upstream}` : ""}. Clique para trocar.`
    : `HEAD destacado em ${status.detached ?? "?"}. Clique para trocar de branch.`;

  return (
    <div className="branch-picker">
      <button
        className={`project-btn branch-btn ${open ? "on" : ""}`}
        title={title}
        disabled={switching}
        onClick={() => {
          if (!open) void loadBranches();
          setOpen(!open);
        }}
      >
        <Icon name="branch" size={13} />
        <span className="branch-name">{label}</span>
        {sync && <span className="branch-sync">{sync}</span>}
        {status.changes.length > 0 && <span className="branch-dirty" title={`${status.changes.length} alterações não commitadas`} />}
      </button>
      {open && <BranchMenu onClose={() => setOpen(false)} />}
    </div>
  );
}

function BranchMenu({ onClose }: { onClose: () => void }) {
  const branches = gitStore.use((s) => s.branches);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const match = branches.filter((b) => !q || b.name.toLowerCase().includes(q));
    // Locais primeiro (a atual no topo), depois remotas.
    const local = match.filter((b) => !b.remote).sort((a, b) => Number(b.current) - Number(a.current));
    const remote = match.filter((b) => b.remote);
    const out: Row[] = [...local, ...remote].map((b) => ({ kind: "branch", name: b.name, remote: b.remote, current: b.current }));
    const name = query.trim();
    if (name && !branches.some((b) => b.name === name)) out.push({ kind: "create", name });
    return out;
  }, [branches, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    listRef.current?.querySelector(".cm-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (row: Row | undefined) => {
    if (!row || (row.kind === "branch" && row.current)) return onClose();
    onClose();
    void (row.kind === "create" ? createBranch(row.name) : switchBranch(row.name));
  };

  return (
    <div ref={ref} className="branch-menu context-menu glass-strong" role="listbox">
      <input
        autoFocus
        className="branch-filter"
        value={query}
        placeholder="Trocar de branch ou digitar um nome para criar"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, rows.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") pick(rows[active]);
          else return;
          e.preventDefault();
        }}
      />
      <div ref={listRef} className="branch-list">
        {rows.length === 0 && <div className="branch-empty">Nenhuma branch encontrada.</div>}
        {rows.map((r, i) => {
          const prev = rows[i - 1];
          const header =
            r.kind === "branch" && (!prev || (prev.kind === "branch" && prev.remote !== r.remote))
              ? r.remote
                ? "Remotas"
                : "Locais"
              : null;
          return (
            <div key={`${r.kind}:${r.name}`}>
              {header && <div className="branch-section">{header}</div>}
              <button
                role="option"
                aria-selected={active === i}
                className={`cm-item ${active === i ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
              >
                <Icon name={r.kind === "create" ? "plus" : r.kind === "branch" && r.current ? "check" : "branch"} size={13} />
                <span>{r.kind === "create" ? `Criar branch “${r.name}”` : r.name}</span>
                {r.kind === "branch" && r.current && <kbd>atual</kbd>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
