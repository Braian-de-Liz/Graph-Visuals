import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icons";
import { addCustomAgent, sessionsStore } from "../state/sessions";

/** Formulário para registrar um agente informando o caminho do executável. */
export function AddAgentForm() {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const browse = async () => {
    const picked = await open({ multiple: false, directory: false });
    if (typeof picked === "string") {
      setPath(picked);
      setError(null);
    }
  };

  const submit = async () => {
    if (!path.trim()) {
      setError("Informe o caminho do executável.");
      return;
    }
    setBusy(true);
    const ok = await addCustomAgent(name, path);
    setBusy(false);
    if (!ok) setError("Caminho não encontrado ou não executável. Use o caminho completo ou um nome que esteja no PATH.");
  };

  return (
    <div className="agent-panel">
      <header className="agent-panel-head">
        <div className="agent-panel-title">
          <h2>Adicionar agente</h2>
          <span className="path">Use o executável original do agente.</span>
        </div>
        <button className="icon-btn" title="Cancelar" onClick={() => sessionsStore.set({ addingAgent: false })}>
          <Icon name="x" />
        </button>
      </header>

      <label className="field-label" htmlFor="agent-name">Nome (opcional)</label>
      <input
        id="agent-name"
        className="agent-form-input"
        value={name}
        placeholder="Ex.: Aider"
        onChange={(e) => setName(e.target.value)}
      />

      <label className="field-label" htmlFor="agent-path">Caminho do executável</label>
      <div className="agent-form-row">
        <input
          id="agent-path"
          className="agent-form-input"
          value={path}
          placeholder="C:\Ferramentas\aider.exe ou aider"
          onChange={(e) => {
            setPath(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <button className="btn" onClick={() => void browse()}>
          Procurar…
        </button>
      </div>
      {error && <p className="agent-form-error">{error}</p>}

      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void submit()}>
        <Icon name="plus" /> Adicionar agente
      </button>
      <p className="isolation-note">
        O caminho é usado exatamente como informado, sem argumentos ou variáveis extras.
      </p>
    </div>
  );
}
