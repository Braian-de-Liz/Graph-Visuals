// Laterais em andares: agente acima, conteúdo da lateral e agente abaixo.
// Direita: o explorador de arquivos (Ctrl+L) fica no meio. Esquerda: o painel
// do agente selecionado. Cada andar mostra o terminal vivo da sessão; mover
// uma sessão entre posições nunca reinicia o processo.
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { AgentGlyph, Icon } from "./Icons";
import { SessionTitle, StopButton, TerminalHost, sessionMenu } from "./AgentSessionView";
import { openContextMenu } from "./ContextMenu";
import { ProjectExplorer } from "./ProjectExplorer";
import { Splitter } from "./Splitter";
import { DOCK_LABEL, closeSession, placeSession, sessionAt, sessionsStore, type Dock } from "../state/sessions";
import { uiStore } from "../state/ui";
import { beginSessionDrag } from "../state/dnd";

export { DOCK_LABEL };

const GLYPH_FILL: Record<Dock, { x: number; y: number; w: number; h: number }> = {
  leftTop: { x: 1.5, y: 1.5, w: 4.5, h: 6.5 },
  leftBottom: { x: 1.5, y: 8, w: 4.5, h: 6.5 },
  primary: { x: 1.5, y: 9, w: 13, h: 5.5 },
  rightTop: { x: 10, y: 1.5, w: 4.5, h: 6.5 },
  rightBottom: { x: 10, y: 8, w: 4.5, h: 6.5 },
};

/** Miniatura da janela com a região da posição preenchida. */
export function DockGlyph({ dock, size = 14 }: { dock: Dock; size?: number }) {
  const f = GLYPH_FILL[dock];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="1" fill="currentColor" />
    </svg>
  );
}

/** Seletor das cinco posições (laterais em cima/embaixo e painel inferior). */
export function DockPicker({ value, onPick, label = "Abrir em" }: { value: Dock | null; onPick: (d: Dock) => void; label?: string }) {
  return (
    <div className="dock-picker" role="radiogroup" aria-label={label}>
      {(Object.keys(DOCK_LABEL) as Dock[]).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          className={`dock-opt ${value === d ? "on" : ""}`}
          title={`${label}: ${DOCK_LABEL[d]}`}
          onClick={(e) => {
            e.stopPropagation();
            onPick(d);
          }}
        >
          <DockGlyph dock={d} />
        </button>
      ))}
    </div>
  );
}

type Section = "top" | "files" | "bottom";

/** Andares de uma lateral. `middle` é o conteúdo próprio da lateral (ou null). */
export function SideDock({ side, middle }: { side: "left" | "right"; middle: ReactNode | null }) {
  const topDock: Dock = side === "left" ? "leftTop" : "rightTop";
  const bottomDock: Dock = side === "left" ? "leftBottom" : "rightBottom";
  const topId = sessionsStore.use((s) => sessionAt(topDock, s));
  const bottomId = sessionsStore.use((s) => sessionAt(bottomDock, s));
  const weightsKey = side === "left" ? "leftWeights" : "rightWeights";
  const weights = uiStore.use((s) => s[weightsKey]);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ a: Section; b: Section; wa: number; wb: number } | null>(null);

  const sections: Section[] = [];
  if (topId) sections.push("top");
  if (middle) sections.push("files");
  if (bottomId) sections.push("bottom");

  // Um CLI precisa de mais largura que a árvore de arquivos.
  const hasAgents = !!(topId || bottomId);
  useEffect(() => {
    if (!hasAgents) return;
    const widthKey = side === "left" ? "leftWidth" : "rightWidth";
    if (uiStore.get()[widthKey] < 420) uiStore.set({ [widthKey]: 420 });
  }, [hasAgents, side]);

  if (!sections.length) return null;
  const total = sections.reduce((t, s) => t + weights[s], 0);

  return (
    <div className={`side-dock side-dock-${side}`} ref={ref}>
      {sections.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && (
            <Splitter
              axis="y"
              onStart={() => {
                const a = sections[i - 1];
                drag.current = { a, b: s, wa: weights[a], wb: weights[s] };
              }}
              onDrag={(d) => {
                const g = drag.current;
                const h = ref.current?.clientHeight ?? 600;
                if (!g) return;
                const pair = g.wa + g.wb;
                const minW = Math.min((90 * total) / h, pair / 2); // ~90 px por andar
                const wa = Math.min(Math.max(g.wa + (d / h) * total, minW), pair - minW);
                uiStore.set((st) => ({ [weightsKey]: { ...st[weightsKey], [g.a]: wa, [g.b]: pair - wa } }));
              }}
            />
          )}
          <div className="side-floor" style={{ flexGrow: weights[s] }}>
            {s === "files" ? middle : <AgentFloor dock={s === "top" ? topDock : bottomDock} />}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function RightDock() {
  const filesOpen = uiStore.use((s) => s.rightOpen);
  return <SideDock side="right" middle={filesOpen ? <ProjectExplorer /> : null} />;
}

function AgentFloor({ dock }: { dock: Dock }) {
  const id = sessionsStore.use((s) => sessionAt(dock, s));
  const session = sessionsStore.use((s) => s.sessions.find((x) => x.id === id) ?? null);
  if (!session) return null;
  const alive = session.state === "running" || session.state === "starting";
  return (
    <section className="agent-floor">
      <header className="floor-head" onPointerDown={(e) => beginSessionDrag(e, session)} onContextMenu={(e) => openContextMenu(e, sessionMenu(session))} title="Arraste para mover a sessão">
        <AgentGlyph id={session.agentId} size={20} />
        <div className="floor-title" title={`${session.agentName} · ${session.title}`}>
          <strong>{session.agentName}</strong>
          <SessionTitle session={session} />
        </div>
        <span className={`pulse ${session.state}`} title={session.state} />
        <span className="spacer" />
        <DockPicker value={dock} onPick={(d) => placeSession(session.id, d)} label="Mover para" />
        <span className="divider" />
        {alive ? (
          <StopButton id={session.id} />
        ) : (
          <button className="icon-btn danger" title="Fechar sessão" onClick={() => closeSession(session.id)}>
            <Icon name="trash" />
          </button>
        )}
        <button className="icon-btn" title="Tirar do andar (a sessão continua ativa na lista de agentes)" onClick={() => placeSession(null, dock)}>
          <Icon name="close" />
        </button>
      </header>
      <div className="floor-body">
        <TerminalHost id={session.id} />
      </div>
    </section>
  );
}
