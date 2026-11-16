import { useEffect } from "react";
import { AgentGlyph, Icon } from "./Icons";
import { SessionTitle, StateChip, StopButton, TerminalHost, sessionMenu } from "./AgentSessionView";
import { openContextMenu } from "./ContextMenu";
import {
  closeSession,
  detectAgents,
  dockOf,
  launchSession,
  placeSession,
  removeCustomAgent,
  sessionsStore,
  setPrimary,
  type Dock,
  type SessionMeta,
} from "../state/sessions";
import { projectStore } from "../state/project";
import { settingsStore } from "../state/settings";
import { DOCK_LABEL, DockPicker, SideDock } from "./RightDock";
import { beginSessionDrag } from "../state/dnd";
import { uiStore } from "../state/ui";
import { AddAgentForm } from "./AddAgentForm";
import type { AgentInfo } from "../lib/ipc";

/** Lateral esquerda: descobrir, iniciar e alternar sessões dos CLIs originais. */
export function AgentSidebar() {
  const mode = uiStore.use((s) => s.left);
  const railHidden = uiStore.use((s) => s.railHidden);
  const columnHidden = uiStore.use((s) => s.columnHidden);
  const maximized = uiStore.use((s) => s.agentMaximized);
  const loaded = sessionsStore.use((s) => s.agentsLoaded);
  const leftTop = sessionsStore.use((s) => s.leftTopId);
  const leftBottom = sessionsStore.use((s) => s.leftBottomId);
  useEffect(() => {
    if (!loaded) void detectAgents();
  }, [loaded]);
  if (mode === "hidden") return null;
  // Com os dois andares ocupados, o painel do agente não entra entre eles.
  // Maximizado: com agentes encaixados na coluna, o painel sai e eles ocupam toda a altura.
  const panel = !columnHidden && mode === "expanded" && !(leftTop && leftBottom) && !(maximized && (leftTop || leftBottom));
  const column = panel || (!columnHidden && (!!leftTop || !!leftBottom));
  return (
    <div className={`agent-sidebar ${mode} ${column ? "with-column" : ""}`}>
      {!railHidden && <AgentList />}
      {column && (
        <div className="left-column">
          <SideDock side="left" middle={panel ? <AgentPanel /> : null} />
        </div>
      )}
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
    sessionsStore.set({ selectedAgentId: a.id, addingAgent: false });
    uiStore.set({ left: "expanded", columnHidden: false });
  };

  const addAgent = () => {
    sessionsStore.set({ addingAgent: true });
    uiStore.set({ left: "expanded", columnHidden: false });
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
        <AgentGlyph id={a.id} label={a.name} />
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
      <button className="agent-rail-item add" title="Adicionar agente" onClick={addAgent}>
        <Icon name="plus" size={14} />
      </button>
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
  const viewedId = sessionsStore.use((s) => s.viewedId);
  const root = projectStore.use((s) => s.root);
  const launchDock = settingsStore.use((s) => s.launchDock);
  // estado completo: usado para saber a posição de cada sessão
  const state = sessionsStore.use((s) => s);
  const agent = agents.find((a) => a.id === selectedId) ?? null;
  const addingAgent = sessionsStore.use((s) => s.addingAgent);
  const custom = settingsStore.use((s) => s.customAgents);
  const maximized = uiStore.use((s) => s.agentMaximized);

  if (addingAgent) return <AddAgentForm />;

  if (!agent) {
    return (
      <div className="agent-panel">
        <div className="panel-empty">Selecione um agente.</div>
      </div>
    );
  }

  const mine = sessions.filter((s) => s.agentId === agent.id);
  const viewed = mine.find((s) => s.id === viewedId) ?? null;

  const create = () => launchSession(agent, root, launchDock);

  return (
    <div className={`agent-panel ${maximized ? "maximized" : ""}`}>
      <header className="agent-panel-head">
        <AgentGlyph id={agent.id} label={agent.name} size={40} />
        <div className="agent-panel-title">
          <h2>{agent.name}</h2>
          <span className={agent.path ? "path" : "path off"} title={agent.path ?? ""}>
            {agent.path ?? `“${agent.command}” não encontrado no PATH`}
          </span>
        </div>
        {custom.some((c) => c.id === agent.id) && (
          <button
            className="icon-btn danger"
            title="Remover agente"
            onClick={() => void removeCustomAgent(agent.id)}
          >
            <Icon name="trash" />
          </button>
        )}
        <button
          className="icon-btn"
          title={maximized ? "Restaurar painel (Ctrl+I)" : "Maximizar sessão no painel (Ctrl+I)"}
          onClick={() => uiStore.set({ agentMaximized: !maximized })}
        >
          <Icon name={maximized ? "collapse" : "expand"} />
        </button>
        <button className="icon-btn" title="Recolher" onClick={() => uiStore.set({ left: "rail" })}>
          <Icon name="panelLeft" />
        </button>
      </header>

      <button className="btn btn-primary btn-block" disabled={!agent.path} onClick={create}>
        <Icon name="plus" /> Nova sessão {root ? `em ${root.split(/[/\\]/).pop()}` : ""}
      </button>
      <div className="launch-row">
        <span className="dock-label">Abrir em: {DOCK_LABEL[launchDock]}</span>
        <DockPicker value={launchDock} onPick={(d) => settingsStore.set({ launchDock: d })} />
      </div>

      <div className="section-label">
        Sessões <span className="count">{mine.length}</span>
      </div>
      <ul className="session-list">
        {mine.length === 0 && <li className="session-empty">Nenhuma sessão deste agente.</li>}
        {mine.map((s) => (
          <SessionRow key={s.id} s={s} dock={dockOf(s.id, state)} viewed={s.id === viewedId} />
        ))}
      </ul>

      <div className="agent-panel-view">
        <MaxToggle />
        {viewed && !dockOf(viewed.id, state) ? (
          <>
            <div className="view-head">
              <span>{viewed.title}</span>
              <DockPicker value={null} onPick={(d) => placeSession(viewed.id, d)} label="Mover para" />
            </div>
            <TerminalHost id={viewed.id} />
          </>
        ) : (
          <div className="panel-empty">
            {mine.some((s) => dockOf(s.id, state))
              ? "As sessões deste agente estão abertas no painel inferior ou nas laterais."
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

function MaxToggle() {
  const maximized = uiStore.use((s) => s.agentMaximized);
  if (!maximized) return null;
  return (
    <button className="icon-btn max-float" title="Restaurar (Ctrl+I)" onClick={() => uiStore.set({ agentMaximized: false })}>
      <Icon name="collapse" />
    </button>
  );
}

function SessionRow({ s, dock, viewed }: { s: SessionMeta; dock: Dock | null; viewed: boolean }) {
  const alive = s.state === "running" || s.state === "starting";
  return (
    <li
      className={`session-row ${viewed ? "viewed" : ""} ${dock ? "primary" : ""}`}
      title={dock ? `Aberta em: ${DOCK_LABEL[dock]} · arraste para mover` : "Clique para ver aqui · arraste para uma posição"}
      onPointerDown={(e) => beginSessionDrag(e, s)}
      onClick={() => !dock && sessionsStore.set({ viewedId: s.id })}
      onDoubleClick={() => setPrimary(s.id)}
      onContextMenu={(e) => openContextMenu(e, sessionMenu(s))}
    >
      <span className={`pulse ${s.state}`} />
      <div className="session-meta">
        <SessionTitle session={s} className="session-title" />
        <StateChip state={s.state} code={s.exitCode} />
      </div>
      <div className="session-actions" onClick={(e) => e.stopPropagation()}>
        <DockPicker value={dock} onPick={(d) => placeSession(dock === d ? null : s.id, d)} label="Posição" />
        {alive ? (
          <StopButton id={s.id} />
        ) : (
          <button className="icon-btn danger" title="Fechar sessão" onClick={() => closeSession(s.id)}>
            <Icon name="trash" />
          </button>
        )}
      </div>
    </li>
  );
}
