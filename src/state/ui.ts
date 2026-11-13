// Estado dos painéis e das camadas flutuantes.
import { createStore, loadJson, saveJson } from "../lib/store";

export type LeftMode = "hidden" | "rail" | "expanded";

/** Modos da Abrir Rápido, como os prefixos do VS Code: "" ">" "#" "@" ":". */
export type FindMode = "files" | "commands" | "symbols" | "fileSymbols" | "line";

export interface LocateResult {
  kind: "file" | "dir" | "symbol";
  /** Caminho relativo com `/` (arquivo ou diretório). */
  rel: string;
  /** Nó destacado no grafo, se houver representação. */
  nodeIndex: number | null;
  /** Linha a abrir no editor (símbolos). */
  line: number | null;
  label: string;
}

interface Layout {
  left: LeftMode;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  bottomHeight: number;
  bottomCollapsed: boolean;
}

interface UiState extends Layout {
  /** Painel inferior temporariamente expandido. */
  bottomExpanded: boolean;
  find: null | FindMode;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  /** Primeira tecla de uma sequência (ex.: "Ctrl+K") aguardando a segunda. */
  chord: string | null;
  locate: LocateResult | null;
  toast: { text: string; tone: "info" | "error"; id: number } | null;
}

const KEY = "gv.layout";

const layout = loadJson<Layout>(KEY, {
  left: "rail",
  leftWidth: 340,
  rightOpen: false, // a lateral direita inicia recolhida
  rightWidth: 300,
  bottomHeight: 300,
  bottomCollapsed: false,
});

export const uiStore = createStore<UiState>({
  ...layout,
  // Nenhum agente está selecionado ao iniciar: a lateral abre como trilho.
  left: layout.left === "expanded" ? "rail" : layout.left,
  bottomHeight: Math.max(layout.bottomHeight, 200),
  rightOpen: false,
  bottomExpanded: false,
  find: null,
  settingsOpen: false,
  shortcutsOpen: false,
  chord: null,
  locate: null,
  toast: null,
});

uiStore.subscribe(() => {
  const s = uiStore.get();
  saveJson(KEY, {
    left: s.left,
    leftWidth: s.leftWidth,
    rightOpen: s.rightOpen,
    rightWidth: s.rightWidth,
    bottomHeight: s.bottomHeight,
    bottomCollapsed: s.bottomCollapsed,
  } satisfies Layout);
});

let toastSeq = 0;
let toastTimer = 0;
export function toast(text: string, tone: "info" | "error" = "info") {
  const id = ++toastSeq;
  uiStore.set({ toast: { text, tone, id } });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (uiStore.get().toast?.id === id) uiStore.set({ toast: null });
  }, tone === "error" ? 6000 : 3200);
}
