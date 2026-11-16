// Atalhos globais no padrão do VS Code (Windows).
//
// Uma tabela única alimenta o despacho de teclas, a paleta de comandos e a
// lista "Atalhos de teclado" (Ctrl+K Ctrl+S).
//
// Terminal: como no VS Code ("commandsToSkipShell"), os comandos de bancada
// (Ctrl+P, Ctrl+Shift+P, Ctrl+B, Ctrl+J, Ctrl+`…) funcionam mesmo com o foco
// no terminal e NÃO são repassados ao CLI. Os demais atalhos (Ctrl+K, Ctrl+W,
// Ctrl+G, Ctrl+O…) ficam com o terminal, para não quebrar atalhos do shell.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openExplorer, uiStore, type FindMode } from "../state/ui";
import { cycleEditorTab, requestEditorSave, requestEditorClose, toggleMarkdownPreview, toggleMarkdownSide } from "../state/editor";
import { sceneApi, selectNode } from "../state/graph";
import { pickAndOpenProject, projectStore } from "../state/project";
import { focusTerminal, isInsideTerminal, launchSession, sessionsStore, toggleRightSide } from "../state/sessions";
import { loadJson, saveJson } from "./store";

export interface Keybinding {
  id: string;
  label: string;
  group: "Geral" | "Navegação" | "Painéis" | "Terminal" | "Editor" | "Janela";
  /** Combinações aceitas, ex.: "ctrl+shift+p". Sequências usam espaço: "ctrl+k ctrl+s". */
  keys: string[];
  /** Funciona com o foco no terminal (o CLI não recebe a tecla). */
  skipShell?: boolean;
  run: () => void;
}

/** Atalhos de edição tratados pelo CodeMirror (apenas para a lista de referência). */
export const EDITOR_KEYS: { keys: string; label: string }[] = [
  { keys: "Ctrl+S", label: "Salvar" },
  { keys: "Shift+Alt+F", label: "Formatar documento (Go, Rust, TS/JS, PHP)" },
  { keys: "F12", label: "Abrir o arquivo da importação (ou Ctrl+clique)" },
  { keys: "Ctrl+F", label: "Localizar" },
  { keys: "Ctrl+H", label: "Substituir" },
  { keys: "F3 / Shift+F3", label: "Próxima / anterior ocorrência" },
  { keys: "Ctrl+G", label: "Ir para a linha" },
  { keys: "Ctrl+Shift+O", label: "Ir para símbolo no arquivo" },
  { keys: "Ctrl+D", label: "Selecionar próxima ocorrência" },
  { keys: "Ctrl+Shift+L", label: "Selecionar todas as ocorrências" },
  { keys: "Alt+↑ / Alt+↓", label: "Mover linha" },
  { keys: "Shift+Alt+↑ / ↓", label: "Duplicar linha" },
  { keys: "Ctrl+Shift+K", label: "Excluir linha" },
  { keys: "Ctrl+Enter", label: "Inserir linha abaixo" },
  { keys: "Ctrl+Shift+Enter", label: "Inserir linha acima" },
  { keys: "Ctrl+/", label: "Alternar comentário de linha" },
  { keys: "Shift+Alt+A", label: "Alternar comentário de bloco" },
  { keys: "Ctrl+] / Ctrl+[", label: "Indentar / remover indentação" },
  { keys: "Tab / Shift+Tab", label: "Indentar / remover indentação" },
  { keys: "Ctrl+Alt+↑ / ↓", label: "Adicionar cursor acima / abaixo" },
  { keys: "Alt+Clique", label: "Adicionar cursor" },
  { keys: "Ctrl+Shift+\\", label: "Ir para o colchete correspondente" },
  { keys: "Ctrl+Shift+[ / ]", label: "Recolher / expandir região" },
  { keys: "Ctrl+Espaço", label: "Sugestões" },
  { keys: "Ctrl+Z / Ctrl+Y", label: "Desfazer / refazer" },
];

// ---------- ações ----------

const openFind = (mode: FindMode) => uiStore.set({ find: mode, locate: null });

function toggleTerminalPanel() {
  const { primaryId } = sessionsStore.get();
  const ui = uiStore.get();
  const inPrimary = !!document.activeElement?.closest(".primary-workspace .xterm");
  if (!ui.bottomCollapsed && inPrimary) {
    uiStore.set({ bottomCollapsed: true, bottomExpanded: false });
    return;
  }
  uiStore.set({ bottomCollapsed: false });
  if (primaryId) requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(primaryId)));
  else newTerminal();
}

/** Ctrl+Shift+`: novo terminal com o shell padrão, no projeto aberto. */
function newTerminal() {
  const shells = sessionsStore.get().agents.filter((a) => a.kind === "shell" && a.path);
  const shell = shells[0];
  if (!shell) return;
  // Painel inferior; se ele estiver em uso, a primeira posição livre.
  launchSession(shell, projectStore.get().root, "primary");
}

let zenSnapshot: { left: ReturnType<typeof uiStore.get>["left"]; rightOpen: boolean; rightHidden: boolean; bottomCollapsed: boolean } | null = null;
function toggleZen() {
  if (zenSnapshot) {
    uiStore.set(zenSnapshot);
    zenSnapshot = null;
  } else {
    const s = uiStore.get();
    zenSnapshot = { left: s.left, rightOpen: s.rightOpen, rightHidden: s.rightHidden, bottomCollapsed: s.bottomCollapsed };
    uiStore.set({ left: "hidden", rightOpen: false, rightHidden: true, bottomCollapsed: true, bottomExpanded: false });
  }
}

const ZOOM_KEY = "gv.zoom";
let zoom = loadJson<{ value: number }>(ZOOM_KEY, { value: 1 }).value;
function setZoom(z: number) {
  zoom = Math.round(Math.min(Math.max(z, 0.5), 2) * 10) / 10;
  saveJson(ZOOM_KEY, { value: zoom });
  void getCurrentWebview().setZoom(zoom);
}
export function restoreZoom() {
  if (zoom !== 1) void getCurrentWebview().setZoom(zoom);
}

async function toggleFullscreen() {
  const win = getCurrentWindow();
  await win.setFullscreen(!(await win.isFullscreen()));
}

function showExplorer() {
  openExplorer();
}

/** Ctrl+B: esconde o painel e as sessões da esquerda, deixando só a barra de ícones; de novo, mostra. */
function toggleLeftColumn() {
  const ui = uiStore.get();
  const { leftTopId, leftBottomId } = sessionsStore.get();
  const visible = !ui.columnHidden && (ui.left === "expanded" || !!leftTopId || !!leftBottomId);
  if (visible) uiStore.set({ columnHidden: true, left: "rail" });
  else uiStore.set({ columnHidden: false, left: "expanded" });
}

// ---------- tabela ----------

export const KEYBINDINGS: Keybinding[] = [
  { id: "quickOpen", group: "Navegação", label: "Abrir rápido (arquivo, diretório, símbolo)", keys: ["ctrl+p"], skipShell: true, run: () => openFind("files") },
  { id: "commands", group: "Geral", label: "Paleta de comandos", keys: ["ctrl+shift+p", "f1"], skipShell: true, run: () => openFind("commands") },
  { id: "workspaceSymbol", group: "Navegação", label: "Ir para símbolo no projeto", keys: ["ctrl+t"], skipShell: true, run: () => openFind("symbols") },
  { id: "fileSymbol", group: "Navegação", label: "Ir para símbolo no arquivo", keys: ["ctrl+shift+o"], run: () => openFind("fileSymbols") },
  { id: "gotoLine", group: "Navegação", label: "Ir para a linha", keys: ["ctrl+g"], run: () => openFind("line") },
  { id: "openFolder", group: "Geral", label: "Abrir pasta (projeto)…", keys: ["ctrl+k ctrl+o", "ctrl+o"], run: () => void pickAndOpenProject() },
  { id: "settings", group: "Geral", label: "Configurações", keys: ["ctrl+,"], skipShell: true, run: () => uiStore.set({ settingsOpen: true }) },
  { id: "shortcuts", group: "Geral", label: "Atalhos de teclado", keys: ["ctrl+k ctrl+s"], run: () => uiStore.set({ shortcutsOpen: true }) },

  { id: "toggleSidebar", group: "Painéis", label: "Alternar barra de agentes", keys: ["ctrl+n"], skipShell: true, run: () => uiStore.set((s) => (s.left === "hidden" ? { left: "rail", railHidden: false } : { railHidden: !s.railHidden })) },
  { id: "toggleAgentRail", group: "Painéis", label: "Alternar lateral esquerda (mantém a barra de ícones)", keys: ["ctrl+b"], skipShell: true, run: toggleLeftColumn },
  { id: "maximizeAgent", group: "Painéis", label: "Maximizar a sessão dentro do painel do agente", keys: ["ctrl+i"], skipShell: true, run: () => uiStore.set((s) => (s.agentMaximized ? { agentMaximized: false } : { left: "expanded", columnHidden: false, agentMaximized: true })) },
  { id: "toggleAuxBar", group: "Painéis", label: "Alternar lateral direita (explorador e agentes)", keys: ["ctrl+l", "ctrl+alt+b"], skipShell: true, run: toggleRightSide },
  { id: "showExplorer", group: "Painéis", label: "Mostrar explorador", keys: ["ctrl+shift+e"], skipShell: true, run: showExplorer },
  { id: "togglePanel", group: "Painéis", label: "Alternar painel (agente principal)", keys: ["ctrl+j"], skipShell: true, run: () => uiStore.set((s) => ({ bottomCollapsed: !s.bottomCollapsed, bottomExpanded: false })) },
  { id: "maximizePanel", group: "Painéis", label: "Maximizar painel", keys: [], run: () => uiStore.set((s) => ({ bottomCollapsed: false, bottomExpanded: !s.bottomExpanded })) },
  { id: "zen", group: "Painéis", label: "Modo zen (só o grafo)", keys: ["ctrl+k z"], run: toggleZen },
  { id: "graphOverview", group: "Navegação", label: "Grafo: visão geral", keys: ["ctrl+e"], run: () => sceneApi()?.resetView() },

  { id: "toggleTerminal", group: "Terminal", label: "Alternar terminal", keys: ["ctrl+`", "ctrl+'"], skipShell: true, run: toggleTerminalPanel },
  { id: "newTerminal", group: "Terminal", label: "Novo terminal", keys: ["ctrl+shift+`"], skipShell: true, run: newTerminal },

  { id: "save", group: "Editor", label: "Salvar", keys: ["ctrl+s"], run: requestEditorSave },
  { id: "closeEditor", group: "Editor", label: "Fechar arquivo", keys: ["ctrl+w", "ctrl+f4"], run: requestEditorClose },
  { id: "nextTab", group: "Editor", label: "Próxima aba", keys: ["ctrl+tab", "ctrl+pagedown"], run: () => cycleEditorTab(1) },
  { id: "prevTab", group: "Editor", label: "Aba anterior", keys: ["ctrl+shift+tab", "ctrl+pageup"], run: () => cycleEditorTab(-1) },
  { id: "mdPreview", group: "Editor", label: "Markdown: alternar prévia", keys: ["ctrl+shift+v"], run: toggleMarkdownPreview },
  { id: "mdPreviewSide", group: "Editor", label: "Markdown: abrir prévia ao lado", keys: ["ctrl+k v"], run: toggleMarkdownSide },

  { id: "fullscreen", group: "Janela", label: "Tela cheia", keys: ["f11"], skipShell: true, run: () => void toggleFullscreen() },
  { id: "zoomIn", group: "Janela", label: "Aumentar zoom", keys: ["ctrl+=", "ctrl+shift+=", "ctrl+numpadadd"], skipShell: true, run: () => setZoom(zoom + 0.1) },
  { id: "zoomOut", group: "Janela", label: "Diminuir zoom", keys: ["ctrl+-", "ctrl+numpadsubtract"], skipShell: true, run: () => setZoom(zoom - 0.1) },
  { id: "zoomReset", group: "Janela", label: "Restaurar zoom", keys: ["ctrl+numpad0", "ctrl+0"], skipShell: true, run: () => setZoom(1) },
];

// ---------- formatação ----------

const NAMES: Record<string, string> = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", "`": "`", "'": "'" };
export function formatKeys(combo: string): string {
  return combo
    .split(" ")
    .map((stroke) =>
      stroke
        .split("+")
        .map((p) => NAMES[p] ?? (p.startsWith("numpad") ? "Num " + p.slice(6) : p.length === 1 ? p.toUpperCase() : p.toUpperCase()))
        .join("+"),
    )
    .join(" ");
}

/** Primeira combinação do comando, formatada (para dicas na interface). */
export function hintFor(id: string): string | undefined {
  const k = KEYBINDINGS.find((b) => b.id === id)?.keys[0];
  return k ? formatKeys(k) : undefined;
}

// ---------- despacho ----------

/** Converte o evento em "ctrl+shift+p". Usa a tecla física (como o VS Code). */
function strokeOf(e: KeyboardEvent): string | null {
  const c = e.code;
  let k: string;
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(c)) k = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) k = c.toLowerCase();
  else if (c.startsWith("Numpad")) k = c.toLowerCase();
  else {
    const map: Record<string, string> = {
      Backquote: "`",
      Quote: "'",
      Equal: "=",
      Minus: "-",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backslash: "\\",
      BracketLeft: "[",
      BracketRight: "]",
      IntlRo: "/",
      Escape: "escape",
      Enter: "enter",
      Tab: "tab",
      PageUp: "pageup",
      PageDown: "pagedown",
    };
    k = map[c] ?? "";
  }
  if (!k || ["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  // No teclado ABNT2, a tecla à esquerda do 1 é "'" (code Backquote) — mesmo atalho do VS Code.
  return [e.ctrlKey || e.metaKey ? "ctrl" : "", e.shiftKey ? "shift" : "", e.altKey ? "alt" : "", k].filter(Boolean).join("+");
}

const index = new Map<string, Keybinding>();
const chordPrefixes = new Set<string>();
for (const b of KEYBINDINGS)
  for (const k of b.keys) {
    index.set(k, b);
    if (k.includes(" ")) chordPrefixes.add(k.split(" ")[0]);
  }

let pendingChord: string | null = null;
let chordTimer = 0;

export function installKeybindings(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat && pendingChord) return;
    const stroke = strokeOf(e);
    if (!stroke) return;
    const inTerminal = isInsideTerminal(document.activeElement);
    const ui = uiStore.get();

    if (pendingChord) {
      const combo = `${pendingChord} ${stroke}`;
      pendingChord = null;
      clearTimeout(chordTimer);
      uiStore.set({ chord: null });
      const b = index.get(combo);
      if (b) {
        e.preventDefault();
        e.stopPropagation();
        b.run();
      }
      return;
    }

    if (stroke === "escape") {
      if (ui.find || ui.settingsOpen || ui.shortcutsOpen) return; // diálogos tratam
      if (ui.locate) {
        uiStore.set({ locate: null });
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      if (inTerminal || el?.closest(".cm-editor, input, textarea, select")) return;
      selectNode(null);
      return;
    }

    if (!inTerminal && chordPrefixes.has(stroke)) {
      e.preventDefault();
      e.stopPropagation();
      pendingChord = stroke;
      uiStore.set({ chord: formatKeys(stroke) });
      chordTimer = window.setTimeout(() => {
        pendingChord = null;
        uiStore.set({ chord: null });
      }, 2000);
      return;
    }

    const b = index.get(stroke);
    if (!b) return;
    if (inTerminal && !b.skipShell) return; // a tecla pertence ao CLI
    e.preventDefault();
    e.stopPropagation(); // impede que o xterm repasse a tecla ao processo
    b.run();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

