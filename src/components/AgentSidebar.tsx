import { useEffect } from "react";
import { AgentGlyph, Icon } from "./Icons";
import { StateChip, TerminalHost } from "./AgentSessionView";
import {
  closeSession,
  detectAgents,
  sessionsStore,
  setPrimary,
  startSession,
  stopSession,
  type SessionMeta,
} from "../state/sessions";
import { projectStore } from "../state/project";
import { uiStore } from "../state/ui";
import type { AgentInfo } from "../lib/ipc";

/** Lateral esquerda: descobrir, iniciar e alternar sessões dos CLIs originais. */
export function AgentSidebar() {
  const mode = uiStore.use((s) => s.left);
  const loaded = sessionsStore.use((s) => s.agentsLoaded);
  useEffect(() => {
    if (!loaded) void detectAgents();
  }, [loaded]);
  if (mode === "hidden") return null;
  return (
    <div className={`agent-sidebar ${mode}`}>
      <AgentList />
      {mode === "expanded" && <AgentPanel />}
    </div>
  );
}

function AgentList() {
  const agents = sessionsStore.use((s) => s.agents);
  const sessions = sessionsStore.use((s) => s.sessions);
  const selected = sessionsStore.use((s) => s.selectedAgentId);
  const primaryId = sessionsStore.use((s) => s.primaryId);
  const mode = uiStore.use((s) => s.left);
  const primaryAgent = sessions.find((s) => s.id === primaryId)?.agentId;

  const pick = (a: AgentInfo) => {
    if (mode === "expanded" && selected === a.id) {
      uiStore.set({ left: "rail" });
      return;
    }
    sessionsStore.set({ selectedAgentId: a.id });
    uiStore.set({ left: "expanded" });
  };

  const render = (a: AgentInfo) => {
    const count = sessions.filter((s) => s.agentId === a.id).length;
    const running = sessions.some((s) => s.agentId === a.id && s.state === "running");
    return (
      <button
        key={a.id}
        className={`agent-rail-item ${selected === a.id && mode === "expanded" ? "active" : ""} ${a.path ? "" : "unavailable"}`}
        title={`${a.name}${a.path ? "" : " (não encontrado no PATH)"}`}
        onClick={() => pick(a)}
      >
        <AgentGlyph id={a.id} />
        <span className={`avail ${a.path ? (running ? "running" : "ok") : "off"}`} />
        {count > 0 && <span className="count">{count}</span>}
        {primaryAgent === a.id && <span className="primary-mark" title="Agente principal" />}
      </button>
    );
  };

  return (
    <nav className="agent-rail">
      <span className="rail-label">Agentes</span>
      {agents.filter((a) => a.kind === "agent").map(render)}
      <span className="rail-divider" />
      <span className="rail-label">Shell</span>
      {agents.filter((a) => a.kind === "shell" && a.path).map(render)}
    </nav>
  );
}

function AgentPanel() {
  const agents = sessionsStore.use((s) => s.agents);
  const selectedId = sessionsStore.use((s) => s.selectedAgentId);
  const sessions = sessionsStore.use((s) => s.sessions);
  const primaryId = sessionsStore.use((s) => s.primaryId);
  const viewedId = sessionsStore.use((s) => s.viewedId);
  const root = projectStore.use((s) => s.root);
  const agent = agents.find((a) => a.id === selectedId) ?? null;

  if (!agent) {
    return (
      <div className="agent-panel">
        <div className="panel-empty">Selecione um agente.</div>
      </div>
    );
  }

  const mine = sessions.filter((s) => s.agentId === agent.id);
  const viewed = mine.find((s) => s.id === viewedId) ?? null;

  const create = () => {
    const id = startSession(agent, root);
    if (!sessionsStore.get().primaryId) setPrimary(id);
    else sessionsStore.set({ viewedId: id });
  };

  return (
    <div className="agent-panel">
      <header className="agent-panel-head">
        <AgentGlyph id={agent.id} size={40} />
        <div className="agent-panel-title">
          <h2>{agent.name}</h2>
          <span className={agent.path ? "path" : "path off"} title={agent.path ?? ""}>
            {agent.path ?? `“${agent.command}” não encontrado no PATH`}
          </span>
        </div>
        <button className="icon-btn" title="Recolher" onClick={() => uiStore.set({ left: "rail" })}>
          <Icon name="panelLeft" />
        </button>
      </header>

      <button className="btn btn-primary btn-block" disabled={!agent.path} onClick={create}>
        <Icon name="plus" /> Nova sessão {root ? `em ${root.split(/[/\\]/).pop()}` : ""}
      </button>

      <div className="section-label">
        Sessões <span className="count">{mine.length}</span>
      </div>
      <ul className="session-list">
        {mine.length === 0 && <li className="session-empty">Nenhuma sessão deste agente.</li>}
        {mine.map((s) => (
          <SessionRow key={s.id} s={s} primary={s.id === primaryId} viewed={s.id === viewedId} />
        ))}
      </ul>

      <div className="agent-panel-view">
        {viewed && viewed.id !== primaryId ? (
          <>
            <div className="view-head">
              <span>{viewed.title}</span>
              <button className="btn btn-sm" onClick={() => setPrimary(viewed.id)}>
                <Icon name="star" size={13} /> Tornar principal
              </button>
            </div>
            <TerminalHost id={viewed.id} />
          </>
        ) : (
          <div className="panel-empty">
            {mine.some((s) => s.id === primaryId)
              ? "A sessão principal está no painel abaixo do grafo."
              : "Selecione uma sessão para interagir aqui."}
          </div>
        )}
      </div>
      <p className="isolation-note">
        Executável original, sem argumentos ou variáveis extras. A IDE só repassa o que você digita.
      </p>
    </div>
  );
}

function SessionRow({ s, primary, viewed }: { s: SessionMeta; primary: boolean; viewed: boolean }) {
  const alive = s.state === "running" || s.state === "starting";
  return (
    <li
      className={`session-row ${viewed ? "viewed" : ""} ${primary ? "primary" : ""}`}
      onClick={() => !primary && sessionsStore.set({ viewedId: s.id })}
      onDoubleClick={() => setPrimary(s.id)}
    >
      <span className={`pulse ${s.state}`} />
      <div className="session-meta">
        <span className="session-title">{s.title}</span>
        <StateChip state={s.state} code={s.exitCode} />
      </div>
      <div className="session-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`icon-btn ${primary ? "gold" : ""}`}
          title={primary ? "Agente principal" : "Tornar principal"}
          onClick={() => setPrimary(primary ? null : s.id)}
        >
          <Icon name="star" />
        </button>
        {alive ? (
          <button className="icon-btn" title="Encerrar processo" onClick={() => stopSession(s.id)}>
            <Icon name="stop" />
          </button>
        ) : (
          <button className="icon-btn danger" title="Fechar sessão" onClick={() => closeSession(s.id)}>
            <Icon name="trash" />
          </button>
        )}
      </div>
    </li>
  );
}
