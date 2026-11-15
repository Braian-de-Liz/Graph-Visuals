// Projeto ativo: raiz, índice de arquivos (pesquisa), estado da árvore e
// arquivos alterados durante a sessão.
import { open } from "@tauri-apps/plugin-dialog";
import { createStore } from "../lib/store";
import { fsIndex, onFsChanged, projectOpen, watchStart, type FsChanged, type IndexEntry } from "../lib/ipc";
import { baseName, dirName, joinRel, pathKey, toRel } from "../lib/paths";
import { addRecentProject, settingsStore } from "./settings";
import { loadForProject, resetForProject, scheduleUpdate } from "./graph";
import { toast } from "./ui";
import { clearActivity, recordActivity } from "./activity";
import { sessionsStore } from "./sessions";
import { resolveDirtyTabs } from "./editor";
import { ask, askAboutDirty } from "./dialog";

function hasRunningSessionIn(root: string): boolean {
  return sessionsStore
    .get()
    .sessions.some((s) => s.state === "running" && !!s.cwd && toRel(root, s.cwd) !== null);
}

interface ProjectState {
  root: string | null;
  name: string;
  index: IndexEntry[];
  indexTruncated: boolean;
  /** Incrementado a cada alteração no disco: diretórios abertos são relidos. */
  treeToken: number;
  /** Caminhos relativos alterados desde a abertura do projeto. */
  modified: ReadonlySet<string>;
  /** Diretórios expandidos na árvore (chaves `pathKey` de caminhos absolutos). */
  expanded: ReadonlySet<string>;
  /** Item a destacar na árvore (caminho absoluto). */
  revealed: string | null;
}

export const projectStore = createStore<ProjectState>({
  root: null,
  name: "",
  index: [],
  indexTruncated: false,
  treeToken: 0,
  modified: new Set(),
  expanded: new Set(),
  revealed: null,
});

let indexTimer = 0;

async function refreshIndex() {
  const root = projectStore.get().root;
  if (!root) return;
  try {
    const { entries, truncated } = await fsIndex(settingsStore.get().excludes);
    if (projectStore.get().root === root) projectStore.set({ index: entries, indexTruncated: truncated });
  } catch (e) {
    console.error("fs_index", e);
  }
}

/**
 * Antes de trocar de projeto: resolve arquivos não salvos e avisa sobre
 * sessões de agente em execução no projeto atual (elas não são encerradas).
 */
async function confirmLeaveProject(): Promise<boolean> {
  const { root, name } = projectStore.get();
  if (!root) return true;
  const running = sessionsStore
    .get()
    .sessions.filter((s) => s.state === "running" && !!s.cwd && toRel(root, s.cwd) !== null);
  const note = running.length
    ? `${running.length === 1 ? "1 sessão de agente continua" : `${running.length} sessões de agente continuam`} em execução em ${name}.`
    : undefined;
  let asked = false;
  const ok = await resolveDirtyTabs((dirty) => {
    asked = true;
    return askAboutDirty(dirty, "Trocar de projeto?", note);
  });
  if (!ok) return false;
  if (asked || !running.length) return true;
  const c = await ask({
    title: "Trocar de projeto?",
    body: `Estas sessões continuam em execução em ${name}. Elas não serão encerradas e seguem acessíveis na lista de agentes.`,
    items: running.map((s) => `${s.agentName} · ${s.title}`),
    actions: [{ id: "go", label: "Trocar de projeto", tone: "primary" }],
  });
  return c === "go";
}

export async function openProject(path: string, opts: { quiet?: boolean } = {}) {
  const current = projectStore.get().root;
  if (current && pathKey(current) !== pathKey(path) && !(await confirmLeaveProject())) return;
  try {
    const root = await projectOpen(path);
    projectStore.set({
      root,
      name: baseName(root),
      index: [],
      treeToken: 0,
      modified: new Set(),
      expanded: new Set(),
      revealed: null,
    });
    addRecentProject(root);
    clearActivity();
    resetForProject();
    await watchStart(settingsStore.get().excludes);
    void refreshIndex();
    void loadForProject();
  } catch (e) {
    if (opts.quiet) toast(`Não foi possível reabrir o último projeto (${baseName(path)}).`, "error");
    else toast(`Não foi possível abrir o projeto: ${e}`, "error");
  }
}

/** Ao iniciar o app: reabre o último projeto aberto (o primeiro dos recentes). */
let restored = false;
export function restoreLastProject() {
  if (restored || projectStore.get().root) return;
  restored = true;
  const last = settingsStore.get().recentProjects[0];
  if (last) void openProject(last, { quiet: true });
}

export async function pickAndOpenProject() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked === "string") await openProject(picked);
}

/** Reinicia watcher e índice após mudar a lista de exclusões. */
export async function applyExcludes() {
  if (!projectStore.get().root) return;
  await watchStart(settingsStore.get().excludes);
  void refreshIndex();
}

function handleFsChanged(e: FsChanged) {
  const { root, modified } = projectStore.get();
  if (!root) return;
  let next: ReadonlySet<string> = modified;
  const changed: string[] = [];
  if (e.paths.length) {
    const set = new Set(modified);
    for (const p of e.paths) {
      const rel = toRel(root, p);
      if (rel) {
        set.add(rel);
        changed.push(rel);
      }
    }
    next = set;
  }
  projectStore.set((s) => ({ treeToken: s.treeToken + 1, modified: next }));
  // Brilho no grafo: só enquanto houver sessão em execução neste projeto.
  if (hasRunningSessionIn(root)) recordActivity(changed);
  clearTimeout(indexTimer);
  indexTimer = window.setTimeout(refreshIndex, 800);
  scheduleUpdate();
}

void onFsChanged(handleFsChanged);

// Reconciliação periódica: cobre eventos perdidos pelo SO.
window.setInterval(() => {
  if (projectStore.get().root && document.visibilityState === "visible") {
    projectStore.set((s) => ({ treeToken: s.treeToken + 1 }));
    void refreshIndex();
  }
}, 60_000);

/** Relê a árvore e o índice de pesquisa (botão "Atualizar" do explorador). */
export function refreshProject() {
  projectStore.set((s) => ({ treeToken: s.treeToken + 1 }));
  void refreshIndex();
}

export function toggleExpanded(absPath: string) {
  const key = pathKey(absPath);
  const next = new Set(projectStore.get().expanded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  projectStore.set({ expanded: next });
}

/** Expande os ancestrais de `rel` na árvore e o destaca. */
export function revealInTree(rel: string) {
  const root = projectStore.get().root;
  if (!root) return;
  const next = new Set(projectStore.get().expanded);
  let dir = dirName(rel);
  while (dir) {
    next.add(pathKey(joinRel(root, dir)));
    dir = dirName(dir);
  }
  projectStore.set({ expanded: next, revealed: joinRel(root, rel) });
}

export const isModified = (rel: string) => projectStore.get().modified.has(rel);
