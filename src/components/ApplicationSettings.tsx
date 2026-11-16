import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { DEFAULT_EXCLUDES, settingsStore } from "../state/settings";
import { applyExcludes } from "../state/project";
import { toast, uiStore } from "../state/ui";
import { KEYBINDINGS, formatKeys } from "../lib/keybindings";

/** Manual resumido: os atalhos vêm da tabela KEYBINDINGS, então não ficam defasados. */
const MANUAL: { title: string; text: string; ids: string[] }[] = [
  { title: "Projeto e navegação", text: "Abra uma pasta, pesquise arquivos e símbolos e volte a visão do grafo.", ids: ["openFolder", "quickOpen", "workspaceSymbol", "graphOverview"] },
  { title: "Painéis", text: "Mostre ou esconda a barra de agentes, o explorador e o painel inferior. O modo zen deixa só o grafo.", ids: ["toggleSidebar", "toggleAgentRail", "toggleAuxBar", "showExplorer", "togglePanel", "zen"] },
  { title: "Terminal", text: "Os comandos de bancada funcionam mesmo com o foco no terminal; as demais teclas vão para o CLI.", ids: ["toggleTerminal", "newTerminal"] },
  { title: "Editor", text: "Salve, feche e alterne entre abas. Atalhos de edição de código estão na lista completa.", ids: ["save", "closeEditor", "nextTab", "prevTab", "mdPreview"] },
  { title: "Janela", text: "Tela cheia e zoom da interface.", ids: ["fullscreen", "zoomIn", "zoomOut", "zoomReset"] },
];

export function ApplicationSettings() {
  const open = uiStore.use((s) => s.settingsOpen);
  if (!open) return null;
  return <SettingsDialog />;
}

function SettingsDialog() {
  const s = settingsStore.get();
  const [excludes, setExcludes] = useState(s.excludes.join("\n"));
  const showHidden = settingsStore.use((x) => x.showHidden);
  const autoGraph = settingsStore.use((x) => x.autoGraph);
  const ambient = settingsStore.use((x) => x.ambientMotion);
  const autoSave = settingsStore.use((x) => x.autoSave);
  const autoSaveDelay = settingsStore.use((x) => x.autoSaveDelay);
  const formatOnSave = settingsStore.use((x) => x.formatOnSave);
  const close = () => uiStore.set({ settingsOpen: false });
  const current = settingsStore.use((x) => x.excludes);
  const parse = (text: string) =>
    text
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  const pending = parse(excludes).join("\n") !== current.join("\n");

  // Esc fecha o diálogo mesmo sem o foco dentro dele.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.set({ settingsOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveExcludes = async () => {
    const list = parse(excludes);
    settingsStore.set({ excludes: list });
    setExcludes(list.join("\n"));
    try {
      await applyExcludes();
      toast(`Exclusões aplicadas (${list.length} diretório${list.length === 1 ? "" : "s"}). Watcher e pesquisa reiniciados.`);
    } catch (e) {
      toast(`Não foi possível aplicar as exclusões: ${e}`, "error");
    }
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="settings glass-strong" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Configurações</h2>
          <button className="icon-btn" onClick={close} title="Fechar">
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-body">
          <section>
            <h3>Grafo</h3>
            <Toggle
              label="Atualizar o grafo automaticamente"
              hint="Reexecuta o Graphify da IDE (debounce de 4 s) quando arquivos mudam."
              value={autoGraph}
              onChange={(v) => settingsStore.set({ autoGraph: v })}
            />
            <Toggle
              label="Movimento ambiente"
              hint="Rotação lenta contínua. Mantém a GPU renderizando."
              value={ambient}
              onChange={(v) => settingsStore.set({ ambientMotion: v })}
            />
          </section>

          <section>
            <h3>Editor</h3>
            <Toggle
              label="Salvar automaticamente"
              hint="Grava o arquivo após um intervalo sem digitar e ao sair do editor (como “files.autoSave: afterDelay” do VS Code)."
              value={autoSave}
              onChange={(v) => settingsStore.set({ autoSave: v })}
            />
            <Toggle
              label="Formatar ao salvar"
              hint="Ao salvar com Ctrl+S, formata Go (gofmt), Rust (rustfmt), TypeScript/JavaScript (Prettier) e PHP (Pint ou PHP-CS-Fixer). Usa as ferramentas instaladas na máquina ou no projeto; não vale para o salvamento automático."
              value={formatOnSave}
              onChange={(v) => settingsStore.set({ formatOnSave: v })}
            />
            <div className="field-row">
              <label>Intervalo (ms)</label>
              <input
                type="number"
                min={200}
                max={60000}
                step={100}
                value={autoSaveDelay}
                disabled={!autoSave}
                onChange={(e) => settingsStore.set({ autoSaveDelay: Math.min(Math.max(Number(e.target.value) || 1000, 200), 60000) })}
              />
            </div>
          </section>

          <section>
            <h3>Arquivos</h3>
            <Toggle
              label="Mostrar arquivos ocultos"
              hint="Itens iniciados por “.” na árvore do projeto."
              value={showHidden}
              onChange={(v) => settingsStore.set({ showHidden: v })}
            />
            <label className="field-label">Diretórios ignorados (watcher e pesquisa)</label>
            <textarea value={excludes} rows={6} spellCheck={false} onChange={(e) => setExcludes(e.target.value)} />
            <div className="row">
              <button className="btn btn-sm btn-primary" disabled={!pending} onClick={() => void saveExcludes()}>
                Aplicar
              </button>
              <button className="btn btn-sm" onClick={() => setExcludes(DEFAULT_EXCLUDES.join("\n"))}>
                Restaurar padrão
              </button>
              {pending && <span className="muted pending-note">Alterações não aplicadas</span>}
            </div>
          </section>

          <section>
            <h3>Agentes</h3>
            <p className="muted">
              Os CLIs são iniciados com o executável original, no diretório do projeto, com o mesmo ambiente da IDE.
              Nenhum prompt, argumento, variável ou arquivo de contexto é adicionado, e o Graphify da IDE nunca é
              compartilhado com os agentes.
            </p>
          </section>

          <section>
            <h3>Manual</h3>
            {MANUAL.map((m) => (
              <div key={m.title} className="manual-block">
                <h4>{m.title}</h4>
                <p className="muted">{m.text}</p>
                <table className="keys-table">
                  <tbody>
                    {m.ids.map((id) => {
                      const b = KEYBINDINGS.find((x) => x.id === id);
                      if (!b) return null;
                      return (
                        <tr key={id}>
                          <td>{b.label}</td>
                          <td className="keys">
                            {b.keys.map((k) => (
                              <span key={k} className="combo">
                                {formatKeys(k)
                                  .split(" ")
                                  .map((stroke, i) => (
                                    <kbd key={i}>{stroke}</kbd>
                                  ))}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="row">
              <button className="btn btn-sm" onClick={() => uiStore.set({ settingsOpen: false, shortcutsOpen: true })}>
                Lista completa de atalhos
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
    </label>
  );
}
