import { useMemo, useState } from "react";
import { Icon } from "./Icons";
import { EDITOR_KEYS, KEYBINDINGS, formatKeys } from "../lib/keybindings";
import { uiStore } from "../state/ui";

/** Ctrl+K Ctrl+S: referência dos atalhos (padrão VS Code). */
export function KeyboardShortcuts() {
  const open = uiStore.use((s) => s.shortcutsOpen);
  if (!open) return null;
  return <ShortcutsDialog />;
}

function ShortcutsDialog() {
  const [q, setQ] = useState("");
  const close = () => uiStore.set({ shortcutsOpen: false });

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = [
      ...KEYBINDINGS.filter((b) => b.keys.length).map((b) => ({
        group: b.group as string,
        label: b.label,
        keys: b.keys.map(formatKeys).join("  ·  "),
        shell: !!b.skipShell,
      })),
      ...EDITOR_KEYS.map((k) => ({ group: "Edição de código", label: k.label, keys: k.keys, shell: false })),
    ].filter((r) => !term || r.label.toLowerCase().includes(term) || r.keys.toLowerCase().includes(term));
    const map = new Map<string, typeof rows>();
    for (const r of rows) map.set(r.group, [...(map.get(r.group) ?? []), r]);
    return [...map];
  }, [q]);

  return (
    <div className="overlay" onMouseDown={close} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="settings shortcuts glass-strong" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Atalhos de teclado</h2>
          <button className="icon-btn" onClick={close} title="Fechar">
            <Icon name="close" />
          </button>
        </header>
        <div className="explorer-search shortcuts-search">
          <Icon name="search" size={14} />
          <input autoFocus value={q} placeholder="Pesquisar atalho" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="settings-body">
          {groups.map(([group, rows]) => (
            <section key={group}>
              <h3>{group}</h3>
              <table className="keys-table">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label + r.keys}>
                      <td>{r.label}</td>
                      <td className="keys">
                        {r.keys.split("  ·  ").map((k) => (
                          <span key={k} className="combo">
                            {k.split(" ").map((stroke, i) => (
                              <kbd key={i}>{stroke}</kbd>
                            ))}
                          </span>
                        ))}
                        {r.shell && <span className="shell-mark" title="Funciona também com o foco no terminal">terminal</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <p className="muted shortcuts-note">
            Atalhos marcados com “terminal” funcionam com o foco em um terminal e não são repassados ao CLI, como no
            VS Code. Os demais ficam com o terminal (Ctrl+K, Ctrl+W, Ctrl+O… seguem para o shell/agente). No teclado
            ABNT2, Ctrl+` é a tecla à esquerda do 1.
          </p>
        </div>
      </div>
    </div>
  );
}
