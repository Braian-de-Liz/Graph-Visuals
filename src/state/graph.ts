// Estado do grafo e ciclo de atualização via Graphify.
//
// O Graphify da IDE só alimenta a visualização. Nada aqui chega aos agentes.
import { createStore } from "../lib/store";
import { graphLoad, graphifyRun } from "../lib/ipc";
import { baseName, pathKey } from "../lib/paths";
import type { GraphData } from "../graph/types";
import { settingsStore } from "./settings";

export type GraphStatus = "none" | "loading" | "analyzing" | "synced" | "outdated" | "error";

interface GraphState {
  graph: GraphData | null;
  status: GraphStatus;
  message: string;
  log: string;
  /** Seleção por id: sobrevive a atualizações do grafo. */
  selectedId: string | null;
  lastSyncAt: number | null;
}

export const graphStore = createStore<GraphState>({
  graph: null,
  status: "none",
  message: "",
  log: "",
  selectedId: null,
  lastSyncAt: null,
});

// ---------- índices derivados (recalculados a cada grafo) ----------

let idIndex = new Map<string, number>();
let fileIndex = new Map<string, number[]>();
let degree = new Uint32Array(0);

function rebuildIndexes(g: GraphData | null) {
  idIndex = new Map();
  fileIndex = new Map();
  degree = new Uint32Array(g?.nodes.length ?? 0);
  if (!g) return;
  g.nodes.forEach((n, i) => {
    idIndex.set(n.id, i);
    if (n.sourceFile) {
      const key = pathKey(n.sourceFile);
      const list = fileIndex.get(key);
      if (list) list.push(i);
      else fileIndex.set(key, [i]);
    }
  });
  for (const e of g.edges) {
    degree[e.source]++;
    degree[e.target]++;
  }
}

export const nodeIndexOf = (id: string | null) => (id === null ? null : idIndex.get(id) ?? null);
export const nodesOfFile = (rel: string) => fileIndex.get(pathKey(rel)) ?? [];
export const degreeOf = (i: number) => degree[i] ?? 0;

/** Nós cujo arquivo está dentro do diretório `rel`. */
export function nodesUnderDir(rel: string): number[] {
  const prefix = rel ? pathKey(rel) + "/" : "";
  const out: number[] = [];
  for (const [key, list] of fileIndex) if (key.startsWith(prefix)) out.push(...list);
  return out;
}

/** Nó que representa um arquivo: o nó do próprio arquivo, ou o mais conectado. */
export function representativeNode(rel: string): number | null {
  const list = nodesOfFile(rel);
  if (!list.length) return null;
  const g = graphStore.get().graph!;
  const name = baseName(rel).toLowerCase();
  const own = list.find((i) => g.nodes[i].label.toLowerCase() === name);
  if (own !== undefined) return own;
  return list.reduce((best, i) => (degree[i] > degree[best] ? i : best), list[0]);
}

export function nodesOfCommunity(c: number | null): number[] {
  const g = graphStore.get().graph;
  if (!g) return [];
  const out: number[] = [];
  g.nodes.forEach((n, i) => n.community === c && out.push(i));
  return out;
}

// ---------- ponte com a cena 3D ----------

export interface SceneApi {
  focusNodes(indices: number[]): void;
  resetView(): void;
}

let scene: SceneApi | null = null;
export const registerScene = (api: SceneApi | null) => (scene = api);
export const sceneApi = () => scene;

export function setGraph(graph: GraphData | null, status: GraphStatus, message = "") {
  rebuildIndexes(graph);
  const prevSel = graphStore.get().selectedId;
  graphStore.set({
    graph,
    status,
    message,
    selectedId: prevSel && idIndex.has(prevSel) ? prevSel : null,
    lastSyncAt: graph ? Date.now() : null,
  });
}

export function selectNode(index: number | null, opts: { fly?: boolean } = {}) {
  const g = graphStore.get().graph;
  const id = index === null || !g ? null : g.nodes[index]?.id ?? null;
  graphStore.set({ selectedId: id });
  if (index !== null && opts.fly) scene?.focusNodes([index]);
}

// ---------- ciclo de análise ----------

let projectSeq = 0;
let running = false;
let dirtyWhileRunning = false;
let debounceTimer = 0;
const AUTO_DEBOUNCE_MS = 4000;

export function resetForProject() {
  projectSeq++;
  clearTimeout(debounceTimer);
  dirtyWhileRunning = false;
  setGraph(null, "loading", "Carregando grafo…");
}

/** Carrega o último grafo válido em cache e agenda uma análise. */
export async function loadForProject() {
  const seq = projectSeq;
  try {
    const cached = await graphLoad();
    if (seq !== projectSeq) return;
    if (cached && cached.nodes.length) {
      setGraph(cached, "synced", "Grafo carregado do cache");
      // O cache pode estar desatualizado se o projeto mudou com a IDE fechada.
      if (settingsStore.get().autoGraph) void runAnalysis();
      else graphStore.set({ status: "outdated" });
    } else {
      setGraph(null, "none", "Sem grafo em cache");
      void runAnalysis();
    }
  } catch (e) {
    if (seq === projectSeq) graphStore.set({ status: "error", message: String(e) });
  }
}

export async function runAnalysis() {
  if (running) {
    dirtyWhileRunning = true;
    return;
  }
  const seq = projectSeq;
  running = true;
  dirtyWhileRunning = false;
  graphStore.set({ status: "analyzing", message: "Graphify analisando o projeto…" });
  try {
    const result = await graphifyRun();
    if (seq !== projectSeq || result.stale) return;
    if (!result.success) {
      graphStore.set({ status: "error", message: "O Graphify falhou", log: result.log });
      return;
    }
    const g = await graphLoad();
    if (seq !== projectSeq) return;
    // Validação: um resultado vazio ou ilegível não substitui o grafo atual.
    if (!g || !g.nodes.length) {
      graphStore.set({ status: "error", message: "O Graphify não produziu nós", log: result.log });
      return;
    }
    setGraph(g, "synced");
    graphStore.set({ log: result.log });
  } catch (e) {
    if (seq === projectSeq) graphStore.set({ status: "error", message: String(e) });
  } finally {
    running = false;
    if (seq === projectSeq && dirtyWhileRunning) scheduleUpdate();
  }
}

/** Chamado pelo File Watcher. Aplica debounce antes de reanalisar. */
export function scheduleUpdate() {
  if (running) {
    dirtyWhileRunning = true;
    return;
  }
  graphStore.set({ status: "outdated", message: "Alterações detectadas no projeto" });
  if (!settingsStore.get().autoGraph) return;
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void runAnalysis(), AUTO_DEBOUNCE_MS);
}
