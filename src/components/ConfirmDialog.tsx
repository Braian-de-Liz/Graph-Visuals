import { useEffect, useRef } from "react";
import { dialogStore } from "../state/dialog";

/** Renderiza o pedido aberto em `dialogStore` (ver `ask`). */
export function ConfirmDialog() {
  const d = dialogStore.use((s) => s.open);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!d) return;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      d.resolve(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [d]);
  if (!d) return null;
  return (
    <div className="modal-backdrop" onPointerDown={() => d.resolve(null)}>
      <div className="confirm-dialog glass-strong" role="alertdialog" aria-modal onPointerDown={(e) => e.stopPropagation()}>
        <h3>{d.title}</h3>
        {d.body && <p>{d.body}</p>}
        {d.items && d.items.length > 0 && (
          <ul className="confirm-items">
            {d.items.slice(0, 8).map((it) => (
              <li key={it}>{it}</li>
            ))}
            {d.items.length > 8 && <li className="more">e mais {d.items.length - 8}…</li>}
          </ul>
        )}
        <div className="confirm-actions">
          <button className="btn" onClick={() => d.resolve(null)}>
            {d.cancelLabel ?? "Cancelar"}
          </button>
          {d.actions.map((a, i) => (
            <button
              key={a.id}
              ref={i === 0 ? firstRef : undefined}
              className={`btn ${a.tone === "primary" ? "btn-primary" : a.tone === "danger" ? "btn-danger" : ""}`}
              onClick={() => d.resolve(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
