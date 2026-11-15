// Estado da janela flutuante do editor e das suas abas.
import { createStore } from "../lib/store";
import { pathKey } from "../lib/paths";
import { settingsStore } from "./settings";

export interface EditorTab {
  path: string;
  dirty: boolean;
}

export type EditorMode = "compact" | "expanded" | "maximized";
/** Markdown: só o código, lado a lado com a prévia, ou só a prévia. */
export type MarkdownView = "code" | "split" | "preview";

interface EditorState {
  /** Arquivo pedido (caminho absoluto). O editor decide quando trocar. */
  requestedPath: string | null;
  requestedLine: number | null;
  /** Incrementado a cada pedido, inclusive para o mesmo arquivo. */
  requestToken: number;
  /** Arquivo efetivamente aberto (aba ativa). */
  openPath: string | null;
  /** Aba ativa tem alterações não salvas. */
  dirty: boolean;
  /** Abas abertas, na ordem exibida. */
  tabs: EditorTab[];
  visible: boolean;
  mode: EditorMode;
  mdView: MarkdownView;
}

export const editorStore = createStore<EditorState>({
  requestedPath: null,
  requestedLine: null,
  requestToken: 0,
  openPath: null,
  dirty: false,
  tabs: [],
  visible: false,
  mode: "compact",
  mdView: "code",
});

export const isMarkdown = (path: string | null) => !!path && /\.(md|markdown|mdx)$/i.test(path);

/** Ctrl+Shift+V: alterna entre o código e a prévia (como no VS Code). */
export function toggleMarkdownPreview() {
  const s = editorStore.get();
  if (!isMarkdown(s.openPath)) return;
  editorStore.set({ mdView: s.mdView === "preview" ? "code" : "preview", visible: true });
}

/** Ctrl+K V: abre a prévia ao lado do código. */
export function toggleMarkdownSide() {
  const s = editorStore.get();
  if (!isMarkdown(s.openPath)) return;
  editorStore.set({ mdView: s.mdView === "split" ? "code" : "split", visible: true });
}

export function openInEditor(absPath: string, line: number | null = null) {
  editorStore.set((s) => ({
    requestedPath: absPath,
    requestedLine: line,
    requestToken: s.requestToken + 1,
    visible: true,
  }));
}

export function showEditor() {
  if (editorStore.get().openPath) editorStore.set({ visible: true });
}

/** Ctrl+Tab / Ctrl+Shift+Tab: próxima / anterior aba. */
export function cycleEditorTab(dir: 1 | -1) {
  const { tabs, openPath } = editorStore.get();
  if (tabs.length < 2 || !openPath) return;
  const i = tabs.findIndex((t) => pathKey(t.path) === pathKey(openPath));
  openInEditor(tabs[(i + dir + tabs.length) % tabs.length].path);
}

// O componente do editor registra as ações usadas pelos atalhos globais e
// pelas proteções contra perda de trabalho (trocar de projeto, fechar a janela).
export interface EditorHandlers {
  save(): void;
  /** Fecha a aba ativa (Ctrl+W). */
  close(): void;
  closeTab(path: string): void;
  /** Grava todas as abas com alterações. Retorna false se alguma falhar. */
  saveAll(): Promise<boolean>;
  /** Fecha todas as abas, descartando alterações. */
  closeAll(): void;
  /** Um arquivo aberto foi renomeado/movido. */
  renamed(oldPath: string, newPath: string): void;
}
let handlers: EditorHandlers | null = null;
export const registerEditorHandlers = (h: EditorHandlers | null) => (handlers = h);
export const requestEditorSave = () => handlers?.save();
export const requestEditorClose = () => handlers?.close();
export const closeEditorTab = (path: string) => handlers?.closeTab(path);
export const saveAllTabs = () => handlers?.saveAll() ?? Promise.resolve(true);
export const editorRenamed = (oldPath: string, newPath: string) => handlers?.renamed(oldPath, newPath);

/** Caminhos das abas com alterações não salvas. */
export const dirtyTabs = () => editorStore.get().tabs.filter((t) => t.dirty).map((t) => t.path);

/**
 * Antes de descartar o editor (trocar de projeto, fechar a janela): salva ou
 * pergunta. `extra` acrescenta uma linha ao diálogo. Retorna false se o
 * usuário cancelar.
 */
export async function resolveDirtyTabs(
  ask: (dirty: string[]) => Promise<"save" | "discard" | null>,
): Promise<boolean> {
  let dirty = dirtyTabs();
  if (!dirty.length || !handlers) return true;
  if (settingsStore.get().autoSave && (await handlers.saveAll())) return true;
  dirty = dirtyTabs();
  if (!dirty.length) return true;
  const choice = await ask(dirty);
  if (choice === null) return false;
  if (choice === "save") return handlers.saveAll();
  handlers.closeAll();
  return true;
}

// Mantém o indicador de alteração da aba ativa em sincronia com `dirty`.
editorStore.subscribe(() => {
  const s = editorStore.get();
  if (!s.openPath) return;
  const key = pathKey(s.openPath);
  const tab = s.tabs.find((t) => pathKey(t.path) === key);
  if (tab && tab.dirty !== s.dirty) {
    editorStore.set({ tabs: s.tabs.map((t) => (t === tab ? { ...t, dirty: s.dirty } : t)) });
  }
});
/** Linha atual / ir para linha no arquivo aberto. */
export function editorGoToLine(line: number) {
  const path = editorStore.get().openPath;
  if (path) openInEditor(path, line);
}

/** "L45" / "L45-L60" -> 45 */
export function parseLine(location: string | null): number | null {
  const m = location?.match(/L(\d+)/);
  return m ? Number(m[1]) : null;
}
