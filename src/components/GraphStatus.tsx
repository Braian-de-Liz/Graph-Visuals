import { useCallback, useRef, useState } from "react";
import { Icon } from "./Icons";
import { graphStore, runAnalysis, type GraphStatus } from "../state/graph";
import { settingsStore } from "../state/settings";
import { toast } from "../state/ui";
import { ago, copyText, useDismiss } from "../lib/useDismiss";

const STATUS: Record<GraphStatus, { label: string; tone: string; text: string }> = {
  none: { label: "NO GRAPH", tone: "idle", text: "Ainda não há grafo para este projeto." },
  loading: { label: "LOADING", tone: "busy", text: "Carregando o grafo…" },
  analyzing: { label: "ANALYZING", tone: "busy", text: "O Graphify está analisando o projeto." },
  synced: { label: "GRAPH SYNCED", tone: "ok", text: "O grafo está em dia com os arquivos." },
  outdated: { label: "OUTDATED", tone: "warn", text: "Há alterações no projeto que o grafo ainda não reflete." },
  error: { label: "GRAPH ERROR", tone: "error", text: "A última análise falhou. O grafo exibido é o último válido." },
};

/** O Graphify não está instalado (mensagem do backend). */
export const isGraphifyMissing = (message: string) => /graphify.*PATH/i.test(message);

const INSTALL = "uv tool install graphifyy";

/** Instruções para instalar o Graphify, com botão de copiar o comando. */
export function GraphifyInstallHint() {
  return (
    <div className="install-hint">
      <p>
        O Graphify não foi encontrado no PATH. Instale-o e reinicie a IDE (ou use <code>pipx install graphifyy</code>):
      </p>
      <div className="install-cmd">
        <code>{INSTALL}</code>
        <button
          className="icon-btn"
          title="Copiar comando"
          onClick={() => void copyText(INSTALL).then(() => toast("Comando copiado"))}
        >
          <Icon name="copy" size={14} />
        </button>
      </div>
    </div>
  );
}

/** Pílula de status do grafo na barra superior; clicar abre detalhes e ações. */
export function GraphStatusPill() {
  const status = graphStore.use((s) => s.status);
  const message = graphStore.use((s) => s.message);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open);
  const st = STATUS[status];
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`status-pill ${st.tone} ${open ? "on" : ""}`}
        title={message || st.text}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i />
        {st.label}
      </button>
      {open && <GraphStatusPanel />}
    </div>
  );
}

function GraphStatusPanel() {
  const status = graphStore.use((s) => s.status);
  const message = graphStore.use((s) => s.message);
  const log = graphStore.use((s) => s.log);
  const lastSyncAt = graphStore.use((s) => s.lastSyncAt);
  const autoGraph = settingsStore.use((s) => s.autoGraph);
  const [showLog, setShowLog] = useState(status === "error");
  const st = STATUS[status];
  const busy = status === "analyzing" || status === "loading";
  return (
    <div className="popover glass-strong graph-status-panel" role="dialog" aria-label="Status do grafo">
      <div className="popover-head">
        <span className={`status-dot ${st.tone}`} />
        <strong>{st.label}</strong>
        {lastSyncAt && <span className="muted">· atualizado {ago(lastSyncAt)}</span>}
      </div>
      <p className="popover-text">{st.text}</p>
      {message && message !== st.text && <p className={`popover-text ${status === "error" ? "error" : ""}`}>{message}</p>}
      {isGraphifyMissing(message) && <GraphifyInstallHint />}
      <label className="popover-check">
        <input type="checkbox" checked={autoGraph} onChange={(e) => settingsStore.set({ autoGraph: e.target.checked })} />
        Regenerar automaticamente quando arquivos mudarem
      </label>
      <div className="popover-actions">
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runAnalysis()}>
          <Icon name="refresh" size={14} /> Regenerar grafo
        </button>
        {log && (
          <>
            <button className="btn btn-sm" onClick={() => setShowLog(!showLog)}>
              {showLog ? "Ocultar log" : "Ver log"}
            </button>
            <button className="btn btn-sm" title="Copiar log" onClick={() => void copyText(log).then(() => toast("Log copiado"))}>
              <Icon name="copy" size={14} />
            </button>
          </>
        )}
      </div>
      {showLog && log && <pre className="log">{log}</pre>}
    </div>
  );
}
