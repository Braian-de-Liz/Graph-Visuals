// Sessões dos agentes (CLIs originais em PTY).
//
// Regras de preservação de contexto (invioláveis):
// - O processo é o executável original, sem argumentos, flags ou variáveis extras.
// - Só a entrada digitada/enviada pelo usuário é repassada ao PTY, sem alteração.
// - A saída é exibida como veio; a IDE não lê, resume ou reaproveita conversas.
//
// Cada sessão mantém um único Terminal xterm.js vivo enquanto existir. O
// elemento DOM do terminal é movido entre a lateral e o painel principal, de
// modo que alternar o agente principal nunca reinicia nem encerra processos.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createStore } from "../lib/store";
import { agentsDetect, ptyKill, ptyResize, ptySpawn, ptyWrite, type AgentInfo } from "../lib/ipc";
import { baseName } from "../lib/paths";

export type SessionState = "starting" | "running" | "exited" | "error";

export interface SessionMeta {
  id: string;
  agentId: string;
  agentName: string;
  /** Rótulo exibido: "AMOTIF — Sessão 1". */
  title: string;
  cwd: string | null;
  state: SessionState;
  exitCode: number | null;
  startedAt: number;
}

interface SessionsState {
  agents: AgentInfo[];
  agentsLoaded: boolean;
  /** Agente aberto na lateral esquerda. */
  selectedAgentId: string | null;
  sessions: SessionMeta[];
  /** Sessão exibida no painel central inferior. */
  primaryId: string | null;
  /** Sessão aberta na lateral (quando não é a principal). */
  viewedId: string | null;
}

export const sessionsStore = createStore<SessionsState>({
  agents: [],
  agentsLoaded: false,
  selectedAgentId: null,
  sessions: [],
  primaryId: null,
  viewedId: null,
});

interface Runtime {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  ptyId: number | null;
  alive: boolean;
}

const runtimes = new Map<string, Runtime>();
let seq = 0;

/** Contêiner fora da tela onde terminais sem painel visível ficam guardados. */
const parking = (() => {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:480px;visibility:hidden;pointer-events:none";
  document.body.appendChild(el);
  return el;
})();

export const TERMINAL_THEME = {
  background: "#050506",
  foreground: "#D9D9DE",
  cursor: "#EDEDEF",
  cursorAccent: "#050506",
  selectionBackground: "rgba(255, 255, 255, 0.18)",
  black: "#1A2130",
  red: "#E0566A",
  green: "#6FCF97",
  yellow: "#D5B66A",
  blue: "#4C8DFF",
  magenta: "#B48EF0",
  cyan: "#39BFFF",
  white: "#C9CED6",
  brightBlack: "#5A6270",
  brightRed: "#FF7085",
  brightGreen: "#8FE3AE",
  brightYellow: "#E9CD8A",
  brightBlue: "#79AAFF",
  brightMagenta: "#CDB0F7",
  brightCyan: "#7FD6FF",
  brightWhite: "#FFFFFF",
};

export async function detectAgents() {
  try {
    const agents = await agentsDetect();
    sessionsStore.set({ agents, agentsLoaded: true });
  } catch (e) {
    console.error("agents_detect", e);
    sessionsStore.set({ agentsLoaded: true });
  }
}

function patchSession(id: string, patch: Partial<SessionMeta>) {
  sessionsStore.set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

export function startSession(agent: AgentInfo, cwd: string | null): string {
  const id = `s${++seq}`;
  const project = cwd ? baseName(cwd) : "Sem projeto";
  const ordinal =
    sessionsStore.get().sessions.filter((s) => s.agentId === agent.id && s.cwd === cwd).length + 1;
  const meta: SessionMeta = {
    id,
    agentId: agent.id,
    agentName: agent.name,
    title: `${project} — Sessão ${ordinal}`,
    cwd,
    state: "starting",
    exitCode: null,
    startedAt: Date.now(),
  };

  const el = document.createElement("div");
  el.className = "xterm-mount";
  parking.appendChild(el);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: false,
    theme: TERMINAL_THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  try {
    fit.fit();
  } catch {
    /* sem dimensões ainda */
  }
  const rt: Runtime = { term, fit, el, ptyId: null, alive: true };
  runtimes.set(id, rt);

  // Entrada: exatamente o que o usuário digita no terminal. Respostas do
  // próprio terminal (ex.: ao pedido de posição do cursor que o ConPTY envia
  // ao iniciar) podem chegar antes de o PTY ter id; ficam em espera e são
  // enviadas na ordem assim que ele existir.
  let early: string[] = [];
  term.onData((d) => {
    if (!rt.alive) return;
    if (rt.ptyId === null) early.push(d);
    else void ptyWrite(rt.ptyId, d);
  });
  term.onResize(({ cols, rows }) => {
    if (rt.ptyId !== null && rt.alive) void ptyResize(rt.ptyId, cols, rows);
  });

  // Copiar/colar como no terminal do VS Code (Windows):
  // Ctrl+C copia se houver seleção (senão envia ^C ao processo);
  // Ctrl+V e Ctrl+Shift+V colam (o texto colado é entrada explícita do usuário);
  // Ctrl+Shift+C sempre copia.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown" || !(e.ctrlKey || e.metaKey) || e.altKey) return true;
    const k = e.key.toLowerCase();
    if (k === "c" && (e.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      e.preventDefault();
      return false;
    }
    if (k === "v") return false; // deixa o navegador disparar o "paste" que o xterm já trata
    return true;
  });

  sessionsStore.set((s) => ({ sessions: [...s.sessions, meta] }));

  ptySpawn({
    program: agent.command,
    cwd,
    cols: term.cols,
    rows: term.rows,
    onEvent: (e) => {
      if (!runtimes.has(id)) return;
      if (e.type === "output") term.write(e.data);
      else {
        rt.alive = false;
        term.write(`\r\n\x1b[90m[processo encerrado${e.code !== null ? ` · código ${e.code}` : ""}]\x1b[0m\r\n`);
        patchSession(id, { state: "exited", exitCode: e.code });
      }
    },
  })
    .then((ptyId) => {
      if (!runtimes.has(id)) {
        void ptyKill(ptyId);
        return;
      }
      rt.ptyId = ptyId;
      if (early.length) void ptyWrite(ptyId, early.join(""));
      early = [];
      if (rt.alive) patchSession(id, { state: "running" });
    })
    .catch((err) => {
      rt.alive = false;
      term.write(`\x1b[31m${String(err)}\x1b[0m\r\n`);
      patchSession(id, { state: "error" });
    });

  return id;
}

/** Envia texto digitado pelo usuário no campo de entrada, seguido de Enter. */
export function sendLine(id: string, text: string) {
  const rt = runtimes.get(id);
  if (!rt || rt.ptyId === null || !rt.alive) return;
  void ptyWrite(rt.ptyId, text + "\r");
}

export function closeSession(id: string) {
  const rt = runtimes.get(id);
  if (rt) {
    if (rt.ptyId !== null && rt.alive) void ptyKill(rt.ptyId);
    rt.term.dispose();
    rt.el.remove();
    runtimes.delete(id);
  }
  sessionsStore.set((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id);
    return {
      sessions,
      primaryId: s.primaryId === id ? null : s.primaryId,
      viewedId: s.viewedId === id ? null : s.viewedId,
    };
  });
}

/** Encerra o processo, mantendo o terminal com a saída visível. */
export function stopSession(id: string) {
  const rt = runtimes.get(id);
  if (rt && rt.ptyId !== null && rt.alive) void ptyKill(rt.ptyId);
}

export function setPrimary(id: string | null) {
  sessionsStore.set((s) => ({ primaryId: id, viewedId: s.viewedId === id ? null : s.viewedId }));
}

// ---------- montagem do DOM do terminal ----------

/** Move o terminal da sessão para `host`. Retorna a função que o devolve. */
export function attachTerminal(id: string, host: HTMLElement): () => void {
  const rt = runtimes.get(id);
  if (!rt) return () => {};
  host.appendChild(rt.el);
  const refit = () => {
    if (host.offsetWidth > 0 && host.offsetHeight > 0) {
      try {
        rt.fit.fit();
      } catch {
        /* ignorado */
      }
    }
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(refit));
  ro.observe(host);
  requestAnimationFrame(refit);
  return () => {
    ro.disconnect();
    if (rt.el.parentElement === host) parking.appendChild(rt.el);
  };
}

export function focusTerminal(id: string) {
  runtimes.get(id)?.term.focus();
}

export function isInsideTerminal(el: Element | null): boolean {
  return !!el?.closest(".xterm");
}
