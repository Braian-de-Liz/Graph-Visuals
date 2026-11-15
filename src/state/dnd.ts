// Arrastar uma sessão de agente pela tela até uma posição (laterais em cima ou
// embaixo, painel inferior). Usa eventos de ponteiro: o arrastar
// nativo do HTML é interceptado pelo Tauri no Windows (drag-and-drop de arquivos).
import { createStore } from "../lib/store";
import { dockOf, placeSession, sessionAt, sessionsStore, type Dock } from "./sessions";
import { uiStore } from "./ui";

export interface DropZone {
  dock: Dock;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DndState {
  drag: { id: string; label: string; agentId: string; x: number; y: number; from: Dock | null } | null;
  zones: DropZone[];
  over: Dock | null;
}

export const dndStore = createStore<DndState>({ drag: null, zones: [], over: null });

const THRESHOLD = 6;

const RAIL = 68;
/** Largura mínima que uma lateral assume ao receber um agente (ver SideDock). */
const AGENT_MIN_W = 420;

/**
 * Retângulo que o andar terá depois de soltar a sessão `dragId` nele,
 * respeitando os outros andares e o conteúdo do meio da lateral.
 */
function floorRect(side: "left" | "right", which: "top" | "bottom", ws: DOMRect, x: number, w: number, dragId: string) {
  const s = sessionsStore.get();
  const ui = uiStore.get();
  const at = (d: Dock) => {
    const id = sessionAt(d, s);
    return id && id !== dragId ? id : null;
  };
  const top = side === "left" ? at("leftTop") : at("rightTop");
  const bottom = side === "left" ? at("leftBottom") : at("rightBottom");
  // À esquerda, o painel do agente sai quando os dois andares ficam ocupados.
  const both = !!(top || which === "top") && !!(bottom || which === "bottom");
  const middle = side === "left" ? ui.left === "expanded" && !both : ui.rightOpen;
  const weights = side === "left" ? ui.leftWeights : ui.rightWeights;
  const sections: ("top" | "files" | "bottom")[] = [];
  if (top || which === "top") sections.push("top");
  if (middle) sections.push("files");
  if (bottom || which === "bottom") sections.push("bottom");
  const total = sections.reduce((t, k) => t + weights[k], 0);
  // Lateral vazia: o andar ocuparia a altura toda, mas os dois destinos
  // precisam ser distintos na tela. Mostra cada um na sua metade.
  if (sections.length === 1) {
    const h = ws.height / 2;
    return { x, y: which === "top" ? ws.top : ws.top + h, w, h };
  }
  let y = ws.top;
  for (const k of sections) {
    const h = (weights[k] / total) * ws.height;
    if (k === which) return { x, y, w, h };
    y += h;
  }
  return { x, y: ws.top, w, h: ws.height };
}

function computeZones(dragId: string): DropZone[] {
  const ws = document.querySelector(".workspace")?.getBoundingClientRect();
  if (!ws) return [];
  const ui = uiStore.get();
  const leftW = Math.max(ui.leftWidth, AGENT_MIN_W);
  const rightW = Math.max(ui.rightWidth, AGENT_MIN_W);
  const lx = ws.left + (ui.railHidden ? 0 : RAIL);
  const rx = ws.right - rightW;
  const zones: DropZone[] = [
    { dock: "leftTop", ...floorRect("left", "top", ws, lx, leftW, dragId) },
    { dock: "leftBottom", ...floorRect("left", "bottom", ws, lx, leftW, dragId) },
    { dock: "rightTop", ...floorRect("right", "top", ws, rx, rightW, dragId) },
    { dock: "rightBottom", ...floorRect("right", "bottom", ws, rx, rightW, dragId) },
  ];
  // Painel inferior: a área central real; altura atual (ou a salva, se recolhido).
  const center = document.querySelector(".center")?.getBoundingClientRect();
  const bottom = document.querySelector(".center-bottom")?.getBoundingClientRect();
  if (center) {
    const h = !ui.bottomCollapsed && bottom ? bottom.height : ui.bottomHeight;
    // Sem sobrepor as áreas das laterais (que podem ainda não estar abertas).
    const x0 = Math.max(center.left, lx + leftW);
    const x1 = Math.min(center.right, rx);
    zones.push({ dock: "primary", x: x0, y: center.bottom - h, w: Math.max(x1 - x0, 120), h });
  }
  return zones;
}

const hit = (zones: DropZone[], x: number, y: number) =>
  zones.find((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h)?.dock ?? null;

/**
 * Inicia (potencialmente) o arrasto de uma sessão. Só vira arrasto depois de
 * alguns pixels, para não atrapalhar cliques. Ignora botões e campos.
 */
export function beginSessionDrag(e: React.PointerEvent, session: { id: string; agentName: string; agentId: string; title: string }) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button, select, input, textarea, a")) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;

  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
      active = true;
      document.body.classList.add("dragging-session");
      dndStore.set({
        zones: computeZones(session.id),
        drag: { id: session.id, label: `${session.agentName} · ${session.title}`, agentId: session.agentId, x: ev.clientX, y: ev.clientY, from: dockOf(session.id) },
      });
    }
    const { zones, drag } = dndStore.get();
    if (!drag) return;
    dndStore.set({ drag: { ...drag, x: ev.clientX, y: ev.clientY }, over: hit(zones, ev.clientX, ev.clientY) });
  };
  const end = (cancel: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    if (!active) return;
    document.body.classList.remove("dragging-session");
    const { over, drag } = dndStore.get();
    dndStore.set({ drag: null, over: null, zones: [] });
    if (!cancel && drag && over && over !== drag.from) placeSession(drag.id, over);
  };
  const up = () => end(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      end(true);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}
