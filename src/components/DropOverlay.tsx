import { AgentGlyph } from "./Icons";
import { DOCK_LABEL, DockGlyph } from "./RightDock";
import { dndStore } from "../state/dnd";

/** Camada exibida durante o arrasto de uma sessão: posições de destino e o "fantasma". */
export function DropOverlay() {
  const drag = dndStore.use((s) => s.drag);
  const zones = dndStore.use((s) => s.zones);
  const over = dndStore.use((s) => s.over);
  if (!drag) return null;
  return (
    <div className="drop-overlay">
      {zones.map((z) => (
        <div
          key={z.dock}
          className={`drop-zone ${over === z.dock ? "over" : ""} ${drag.from === z.dock ? "current" : ""}`}
          style={{ left: z.x + 3, top: z.y + 3, width: z.w - 6, height: z.h - 6 }}
        >
          <span className="drop-label">
            <DockGlyph dock={z.dock} size={16} />
            {DOCK_LABEL[z.dock]}
            {drag.from === z.dock && <em>atual</em>}
          </span>
        </div>
      ))}
      <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}>
        <AgentGlyph id={drag.agentId} size={20} />
        <span>{drag.label}</span>
      </div>
      <div className="drop-hint">Solte numa posição · Esc cancela</div>
    </div>
  );
}
