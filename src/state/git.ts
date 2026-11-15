// Estado Git do projeto ativo: branch atual, branches disponíveis e as
// alterações da working tree até o próximo commit (como no VS Code).
import { createStore } from "../lib/store";
import {
  gitBranches,
  gitCheckout,
  gitCreateBranch,
  gitStatus,
  onFsChanged,
  onGitChanged,
  type GitBranch,
  type GitChange,
  type GitStatus,
} from "../lib/ipc";
import { dirName } from "../lib/paths";
import { projectStore } from "./project";
import { toast } from "./ui";

interface GitState {
  /** null enquanto não carregado ou sem projeto. */
  status: GitStatus | null;
  /** Alterações por caminho relativo em minúsculas. */
  byRel: ReadonlyMap<string, GitChange>;
  /** Diretórios (relativos, minúsculas) com alguma alteração dentro. */
  dirtyDirs: ReadonlySet<string>;
  branches: GitBranch[];
  switching: boolean;
}

export const gitStore = createStore<GitState>({
  status: null,
  byRel: new Map(),
  dirtyDirs: new Set(),
  branches: [],
  switching: false,
});

const EMPTY = { status: null, byRel: new Map(), dirtyDirs: new Set<string>(), branches: [] };

function index(changes: GitChange[]) {
  const byRel = new Map<string, GitChange>();
  const dirtyDirs = new Set<string>();
  for (const c of changes) {
    const key = c.rel.toLowerCase();
    byRel.set(key, c);
    for (let d = dirName(key); d; d = dirName(d)) {
      if (dirtyDirs.has(d)) break;
      dirtyDirs.add(d);
    }
  }
  return { byRel, dirtyDirs };
}

let inFlight = false;
let pending = false;

/** Relê o status. Chamadas durante uma leitura são agrupadas numa só. */
export async function refreshGit() {
  const root = projectStore.get().root;
  if (!root) return;
  if (inFlight) {
    pending = true;
    return;
  }
  inFlight = true;
  try {
    const status = await gitStatus();
    if (projectStore.get().root === root) gitStore.set({ status, ...index(status.changes) });
  } catch (e) {
    console.error("git_status", e);
  } finally {
    inFlight = false;
    if (pending) {
      pending = false;
      void refreshGit();
    }
  }
}

let timer = 0;
function scheduleRefresh(delay = 250) {
  clearTimeout(timer);
  timer = window.setTimeout(refreshGit, delay);
}

export async function loadBranches() {
  try {
    gitStore.set({ branches: await gitBranches() });
  } catch (e) {
    toast(`Não foi possível listar as branches: ${e}`, "error");
  }
}

async function run(action: () => Promise<void>, done: string) {
  if (gitStore.get().switching) return;
  gitStore.set({ switching: true });
  try {
    await action();
    toast(done);
  } catch (e) {
    toast(String(e), "error");
  } finally {
    gitStore.set({ switching: false });
    await refreshGit();
    // A troca de branch reescreve arquivos: a árvore relê os diretórios abertos.
    projectStore.set((s) => ({ treeToken: s.treeToken + 1 }));
  }
}

export const switchBranch = (name: string) => run(() => gitCheckout(name), `Branch: ${name}`);
export const createBranch = (name: string) => run(() => gitCreateBranch(name), `Branch criada: ${name.trim()}`);

export const gitChangeOf = (rel: string) => gitStore.get().byRel.get(rel.toLowerCase());

// Projeto trocado: zera e relê.
let lastRoot: string | null = null;
projectStore.subscribe(() => {
  const root = projectStore.get().root;
  if (root === lastRoot) return;
  lastRoot = root;
  gitStore.set(EMPTY);
  if (root) void refreshGit();
});

void onFsChanged(() => scheduleRefresh());
void onGitChanged(() => scheduleRefresh(150));
// Repositórios cujo .git fica fora da raiz do projeto não geram eventos.
window.addEventListener("focus", () => scheduleRefresh(0));
window.setInterval(() => {
  if (projectStore.get().root && document.visibilityState === "visible") void refreshGit();
}, 30_000);
