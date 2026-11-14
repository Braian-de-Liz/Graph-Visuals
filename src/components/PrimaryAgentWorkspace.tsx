import { AgentGlyph, Icon } from "./Icons";
import { SessionInput, StateChip, TerminalHost } from "./AgentSessionView";
import { closeSession, launchSession, placeSession, sessionsStore, setPrimary, stopSession } from "../state/sessions";
import { projectStore } from "../state/project";
import { uiStore } from "../state/ui";
import { settingsStore } from "../state/settings";
import { DOCK_LABEL, DockPicker } from "./RightDock";
import { beginSessionDrag } from "../state/dnd";

/** Painel central inferior: a sessão escolhida como agente principal. */
export function PrimaryAgentWorkspace() {
  const sessions = sessionsStore.use((s) => s.sessions);
  const primaryId = sessionsStore.use((s) => s.primaryId);
  const agents = sessionsStore.use((s) => s.agents);
  const collapsed = uiStore.use((s) => s.bottomCollapsed);
  const expanded = uiStore.use((s) => s.bottomExpanded);
  const root = projectStore.use((s) => s.root);
  const launchDock = settingsStore.use((s) => s.launchDock);
  const session = sessions.find((s) => s.id === primaryId) ?? null;

  const toggleCollapse = () => uiStore.set({ bottomCollapsed: !collapsed, bottomExpanded: false });

  return (
    <section className={`primary-workspace ${collapsed ? "collapsed" : ""}`}>
      <header
        className={`primary-head ${session ? "has-session" : ""}`}
        onDoubleClick={toggleCollapse}
        onPointerDown={(e) => session && beginSessionDrag(e, session)}
      >
        {session ? (
          <>
            <AgentGlyph id={session.agentId} size={24} />
            <strong className="primary-agent">{session.agentName}</strong>
            <span className="primary-session">{session.title}</span>
            <StateChip state={session.state} code={session.exitCode} />
            <span className="primary-cwd" title={session.cwd ?? ""}>
              {session.cwd}
            </span>
          </>
        ) : (
          <>
            <span className="eyebrow">Agente principal</span>
            <span className="primary-session muted">nenhuma sessão selecionada</span>
          </>
        )}
        <span className="spacer" />
        {sessions.length > 1 && (
          <select
            className="select"
            value={primaryId ?? ""}
            title="Alternar agente principal (a sessão anterior continua ativa)"
            onChange={(e) => setPrimary(e.target.value || null)}
          >
            <option value="">— nenhum —</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.agentName} · {s.title}
              </option>
            ))}
          </select>
        )}
        {session && (
          <>
            <DockPicker value="primary" onPick={(d) => placeSession(session.id, d)} label="Mover para" />
            {session.state === "running" || session.state === "starting" ? (
              <button className="icon-btn" title="Encerrar processo" onClick={() => stopSession(session.id)}>
                <Icon name="stop" />
              </button>
            ) : (
              <button className="icon-btn danger" title="Fechar sessão" onClick={() => closeSession(session.id)}>
                <Icon name="trash" />
              </button>
            )}
          </>
        )}
        {!collapsed && (
          <button
            className="icon-btn"
            title={expanded ? "Restaurar altura" : "Expandir painel"}
            onClick={() => uiStore.set({ bottomExpanded: !expanded })}
          >
            <Icon name={expanded ? "collapse" : "expand"} />
          </button>
        )}
        <button className="icon-btn" title={collapsed ? "Mostrar painel (Ctrl+J)" : "Recolher painel (Ctrl+J)"} onClick={toggleCollapse}>
          <Icon name={collapsed ? "chevronRight" : "chevronDown"} style={{ transform: collapsed ? "rotate(-90deg)" : undefined }} />
        </button>
      </header>

      {!collapsed && (
        <div className="primary-body">
          {session ? (
            <>
              <TerminalHost id={session.id} />
              <SessionInput session={session} />
            </>
          ) : (
            <div className="primary-empty">
              <p>Escolha um agente para iniciar uma sessão no projeto{root ? "" : " (ou abra um projeto primeiro)"}.</p>
              <div className="quick-agents">
                {agents
                  .filter((a) => a.path)
                  .map((a) => (
                    <button
                      key={a.id}
                      className="quick-agent"
                      onClick={() => launchSession(a, root, launchDock)}
                      title={`Iniciar ${a.name} · ${DOCK_LABEL[launchDock]}`}
                    >
                      <AgentGlyph id={a.id} size={28} />
                      <span>{a.name}</span>
                    </button>
                  ))}
              </div>
              <div className="launch-row centered">
                <span>Abrir em: {DOCK_LABEL[launchDock]}</span>
                <DockPicker value={launchDock} onPick={(d) => settingsStore.set({ launchDock: d })} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
