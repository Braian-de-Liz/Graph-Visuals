// Estado da janela flutuante do editor.
import { createStore } from "../lib/store";

export type EditorMode = "compact" | "expanded" | "maximized";
/** Markdown: só o código, lado a lado com a prévia, ou só a prévia. */
export type MarkdownView = "code" | "split" | "preview";

interface EditorState {
  /** Arquivo pedido (caminho absoluto). O editor decide quando trocar. */
  requestedPath: string | null;
  requestedLine: number | null;
  /** Incrementado a cada pedido, inclusive para o mesmo arquivo. */
  requestToken: number;
  /** Arquivo efetivamente aberto. */
  openPath: string | null;
  dirty: boolean;
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

// O componente do editor registra as ações usadas pelos atalhos globais.
let handlers: { save(): void; close(): void } | null = null;
export const registerEditorHandlers = (h: typeof handlers) => (handlers = h);
export const requestEditorSave = () => handlers?.save();
export const requestEditorClose = () => handlers?.close();
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
