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
  /** Trilho de agentes (lateral esquerda) oculto com Ctrl+N; os andares continuam. */
  railHidden: boolean;
  bottomHeight: number;
  bottomCollapsed: boolean;
  /** Proporção dos andares da lateral direita (agente acima, arquivos, agente abaixo). */
  rightWeights: { top: number; files: number; bottom: number };
  /** Proporção dos andares da lateral esquerda (agente acima, painel do agente, agente abaixo). */
  leftWeights: { top: number; files: number; bottom: number };
}

interface UiState extends Layout {
  /** Lateral direita inteira oculta (Ctrl+L), mesmo com agentes nos andares. */
  rightHidden: boolean;
  /** Painel inferior temporariamente expandido. */
  bottomExpanded: boolean;
  find: null | FindMode;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  /** Primeira tecla de uma sequência (ex.: "Ctrl+K") aguardando a segunda. */
  chord: string | null;
  locate: LocateResult | null;
  /** Avisos visíveis agora (no máximo 3). */
  toasts: ToastItem[];
  /** Histórico da sessão, mais recente primeiro (no máximo 30). */
  notices: ToastItem[];
  /** Erros ainda não vistos no histórico. */
  unseenErrors: number;
}

export interface ToastItem {
  id: number;
  text: string;
  tone: "info" | "error";
  at: number;
}

const KEY = "gv.layout";

const layout = {
  left: "rail" as LeftMode,
  leftWidth: 340,
  rightOpen: false, // a lateral direita inicia recolhida
  rightWidth: 300,
  railHidden: false,
  bottomHeight: 300,
  bottomCollapsed: false,
  rightWeights: { top: 1, files: 1, bottom: 1 },
  leftWeights: { top: 1, files: 1, bottom: 1 },
  ...loadJson<Partial<Layout>>(KEY, {}),
};

export const uiStore = createStore<UiState>({
  ...layout,
  // Nenhum agente está selecionado ao iniciar: a lateral abre como trilho.
  left: layout.left === "expanded" ? "rail" : layout.left,
  bottomHeight: Math.max(layout.bottomHeight, 200),
  rightOpen: false,
  rightHidden: false,
  bottomExpanded: false,
  find: null,
  settingsOpen: false,
  shortcutsOpen: false,
  chord: null,
  locate: null,
  toasts: [],
  notices: [],
  unseenErrors: 0,
});

uiStore.subscribe(() => {
  const s = uiStore.get();
  saveJson(KEY, {
    left: s.left,
    leftWidth: s.leftWidth,
    rightOpen: s.rightOpen,
    rightWidth: s.rightWidth,
    railHidden: s.railHidden,
    bottomHeight: s.bottomHeight,
    bottomCollapsed: s.bottomCollapsed,
    rightWeights: s.rightWeights,
    leftWeights: s.leftWeights,
  } satisfies Layout);
});

/** Mostra o explorador de arquivos (reexibe a lateral direita se estiver oculta). */
export const openExplorer = () => uiStore.set({ rightOpen: true, rightHidden: false });

/** Botão do explorador: alterna só a árvore de arquivos; os agentes da lateral ficam. */
export const toggleExplorer = () =>
  uiStore.set((s) => (s.rightHidden ? { rightHidden: false, rightOpen: true } : { rightOpen: !s.rightOpen }));

let toastSeq = 0;
export function toast(text: string, tone: "info" | "error" = "info") {
  const item: ToastItem = { id: ++toastSeq, text, tone, at: Date.now() };
  uiStore.set((s) => ({
    toasts: [...s.toasts.filter((t) => t.text !== text), item].slice(-3),
    notices: [item, ...s.notices].slice(0, 30),
    unseenErrors: s.unseenErrors + (tone === "error" ? 1 : 0),
  }));
  window.setTimeout(() => dismissToast(item.id), tone === "error" ? 8000 : 3200);
}

export const dismissToast = (id: number) => uiStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));