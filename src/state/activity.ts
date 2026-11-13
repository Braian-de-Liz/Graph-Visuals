// Atividade de arquivos durante sessões de agentes.
//
// Fonte única: o File Watcher do sistema de arquivos. A IDE não lê conversas,
// não intercepta processos e não envia nada aos agentes; apenas observa quais
// arquivos do projeto foram gravados enquanto há sessões em execução nele.
// Leituras feitas pelo agente não são observáveis por esse meio.
import { createStore } from "../lib/store";
import { pathKey } from "../lib/paths";

/** Tempo (s) até o brilho de atividade se apagar. */
export const ACTIVITY_TTL = 45;

interface ActivityState {
  /** pathKey(rel) -> instante (performance.now()/1000) da última gravação. */
  recent: ReadonlyMap<string, number>;
  /** Incrementado a cada novo evento. */
  version: number;
}

export const activityStore = createStore<ActivityState>({ recent: new Map(), version: 0 });

type Listener = (rels: string[], at: number) => void;
const listeners = new Set<Listener>();

export function onActivity(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const nowSeconds = () => performance.now() / 1000;

// Gravações feitas pelo próprio editor da IDE não contam como atividade do agente.
const selfWrites = new Map<string, number>();
export function markSelfWrite(rel: string) {
  selfWrites.set(pathKey(rel), nowSeconds());
}

export function recordActivity(rels: string[]) {
  const at = nowSeconds();
  rels = rels.filter((r) => {
    const t = selfWrites.get(pathKey(r));
    return t === undefined || at - t > 3;
  });
  if (!rels.length) return;
  const next = new Map(activityStore.get().recent);
  for (const [k, t] of next) if (at - t > ACTIVITY_TTL) next.delete(k);
  for (const r of rels) next.set(pathKey(r), at);
  activityStore.set((s) => ({ recent: next, version: s.version + 1 }));
  listeners.forEach((l) => l(rels, at));
  // Atualiza indicadores na interface quando o brilho expira.
  window.setTimeout(() => activityStore.set((s) => ({ version: s.version + 1 })), ACTIVITY_TTL * 1000 + 100);
}

export function clearActivity() {
  activityStore.set((s) => ({ recent: new Map(), version: s.version + 1 }));
}

export function isActive(rel: string): boolean {
  const t = activityStore.get().recent.get(pathKey(rel));
  return t !== undefined && nowSeconds() - t < ACTIVITY_TTL;
}
