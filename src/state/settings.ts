// Preferências da aplicação, persistidas no localStorage.
import { createStore, loadJson, saveJson } from "../lib/store";

export interface Settings {
  /** Diretórios ignorados pelo watcher e pelo índice de pesquisa. */
  excludes: string[];
  showHidden: boolean;
  /** Regenerar o grafo automaticamente quando arquivos mudarem. */
  autoGraph: boolean;
  /** Movimento ambiente do grafo (rotação lenta). Mantém a GPU ativa. */
  ambientMotion: boolean;
  recentProjects: string[];
}

const KEY = "gv.settings";

export const DEFAULT_EXCLUDES = [".git", "node_modules", "target", "dist", "build", "out", ".next", "graphify-out"];

export const settingsStore = createStore<Settings>(
  loadJson<Settings>(KEY, {
    excludes: DEFAULT_EXCLUDES,
    showHidden: false,
    autoGraph: true,
    ambientMotion: false,
    recentProjects: [],
  }),
);

settingsStore.subscribe(() => saveJson(KEY, settingsStore.get()));

export function addRecentProject(path: string) {
  const list = settingsStore.get().recentProjects.filter((p) => p.toLowerCase() !== path.toLowerCase());
  settingsStore.set({ recentProjects: [path, ...list].slice(0, 6) });
}
