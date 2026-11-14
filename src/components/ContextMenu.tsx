// Menu de contexto genérico (clique direito), no estilo do VS Code.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createStore } from "../lib/store";

export type MenuItem =
  | { label: string; run: () => void; hint?: string; danger?: boolean; disabled?: boolean }
  | "separator";

interface MenuState {
  open: { x: number; y: number; items: MenuItem[] } | null;
}

const menuStore = createStore<MenuState>({ open: null });

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  menuStore.set({ open: { x: e.clientX, y: e.clientY, items } });
}

const close = () => menuStore.set({ open: null });

export function ContextMenu() {
  const open = menuStore.use((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(-1);

  // Mantém o menu inteiro dentro da janela.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(open.x, window.innerWidth - r.width - 6),
      y: Math.min(open.y, window.innerHeight - r.height - 6),
    });
    setActive(-1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = open.items;
    const enabled = (i: number) => items[i] !== "separator" && !(items[i] as { disabled?: boolean }).disabled;
    const step = (from: number, dir: number) => {
      for (let k = 1; k <= items.length; k++) {
        const i = (from + dir * k + items.length * 2) % items.length;
        if (enabled(i)) return i;
      }
      return from;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") setActive((a) => step(a, 1));
      else if (e.key === "ArrowUp") setActive((a) => step(a < 0 ? 0 : a, -1));
      else if (e.key === "Enter") {
        setActive((a) => {
          const it = items[a];
          if (a >= 0 && it !== "separator" && !it.disabled) {
            close();
            it.run();
          }
          return a;
        });
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="context-menu glass-strong"
      role="menu"
      style={{ left: pos.x || open.x, top: pos.y || open.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {open.items.map((it, i) =>
        it === "separator" ? (
          <div key={i} className="cm-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`cm-item ${it.danger ? "danger" : ""} ${active === i ? "active" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              close();
              it.run();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
