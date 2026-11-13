import { useState } from "react";
import { Icon } from "./Icons";
import { DEFAULT_EXCLUDES, settingsStore } from "../state/settings";
import { applyExcludes } from "../state/project";
import { showTestGraph } from "../state/graph";
import { uiStore } from "../state/ui";
import { makeTestGraph } from "../graph/testGraph";

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
  const [testSize, setTestSize] = useState(5000);
  const close = () => uiStore.set({ settingsOpen: false });

  const saveExcludes = () => {
    const list = excludes
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
    settingsStore.set({ excludes: list });
    void applyExcludes();
  };

  return (
    <div className="overlay" onMouseDown={close} onKeyDown={(e) => e.key === "Escape" && close()}>
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
            <div className="field-row">
              <label>Grafo de teste</label>
              <input
                type="number"
                min={10}
                max={200000}
                step={1000}
                value={testSize}
                onChange={(e) => setTestSize(Number(e.target.value) || 0)}
              />
              <button
                className="btn btn-sm"
                onClick={() => {
                  showTestGraph(makeTestGraph(Math.max(10, testSize)));
                  close();
                }}
              >
                Carregar
              </button>
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
              <button className="btn btn-sm btn-primary" onClick={saveExcludes}>
                Aplicar
              </button>
              <button className="btn btn-sm" onClick={() => setExcludes(DEFAULT_EXCLUDES.join("\n"))}>
                Restaurar padrão
              </button>
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
