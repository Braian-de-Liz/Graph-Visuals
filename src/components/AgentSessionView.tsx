import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Icon } from "./Icons";
import { attachTerminal, closeSession, focusTerminal, renameSession, requestStop, sendLine, sessionsStore, setPrimary, startRenameSession, type SessionMeta } from "../state/sessions";
import type { MenuItem } from "./ContextMenu";

/** Exibe o terminal vivo de uma sessão. O terminal é movido, nunca recriado. */
export function TerminalHost({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const detach = attachTerminal(id, ref.current!);
    return detach;
  }, [id]);
  return <div className="terminal-host" ref={ref} onMouseDown={() => requestAnimationFrame(() => focusTerminal(id))} />;
}

/**
 * Campo de entrada opcional. Envia exatamente o texto digitado, seguido de
 * Enter, somente quando o usuário confirma.
 */
export function SessionInput({ session }: { session: SessionMeta }) {
  const [text, setText] = useState("");
  const alive = session.state === "running";
  const submit = () => {
    if (!text || !alive) return;
    sendLine(session.id, text);
    setText("");
  };
  return (
    <form
      className="session-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        value={text}
        disabled={!alive}
        spellCheck={false}
        placeholder={alive ? `Enviar para ${session.agentName}…  (ou digite direto no terminal)` : "Sessão encerrada"}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="icon-btn" disabled={!alive || !text} title="Enviar (Enter)">
        <Icon name="send" />
      </button>
    </form>
  );
}

export function StateChip({ state, code }: { state: SessionMeta["state"]; code?: number | null }) {
  const label =
    state === "starting" ? "iniciando" : state === "running" ? "em execução" : state === "error" ? "falhou" : `encerrada${code != null ? ` · ${code}` : ""}`;
  return <span className={`state-chip ${state}`}>{label}</span>;
}

/** Título da sessão; clique duplo (ou "Renomear…" no menu) edita no lugar. */
export function SessionTitle({ session, className }: { session: SessionMeta; className?: string }) {
  const editing = sessionsStore.use((s) => s.renamingId === session.id);
  const done = useRef(false);
  if (editing) {
    done.current = false;
    const finish = (value: string | null) => {
      if (done.current) return;
      done.current = true;
      if (value === null) sessionsStore.set({ renamingId: null });
      else renameSession(session.id, value);
    };
    return (
      <input
        className="session-rename"
        autoFocus
        defaultValue={session.title}
        spellCheck={false}
        aria-label="Nome da sessão"
        onFocus={(e) => e.currentTarget.select()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(e.currentTarget.value);
          else if (e.key === "Escape") finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    );
  }
  return (
    <span
      className={className}
      title={`${session.title} · clique duplo para renomear`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startRenameSession(session.id);
      }}
    >
      {session.title}
    </span>
  );
}

/** Menu de contexto de uma sessão (lista, painel inferior e andares). */
export function sessionMenu(s: SessionMeta): MenuItem[] {
  const alive = s.state === "running" || s.state === "starting";
  const isPrimary = sessionsStore.get().primaryId === s.id;
  return [
    { label: "Renomear…", run: () => startRenameSession(s.id) },
    { label: "Tornar agente principal", disabled: isPrimary, run: () => setPrimary(s.id) },
    "separator",
    alive
      ? { label: "Encerrar processo…", danger: true, run: () => void requestStop(s.id) }
      : { label: "Fechar sessão", danger: true, run: () => closeSession(s.id) },
  ];
}

/** Botão de encerrar: confirma antes; Shift+clique encerra direto. */
export function StopButton({ id }: { id: string }) {
  return (
    <button
      className="icon-btn"
      title="Encerrar processo (Shift+clique: sem confirmar)"
      onClick={(e) => {
        e.stopPropagation();
        void requestStop(id, e.shiftKey);
      }}
    >
      <Icon name="stop" />
    </button>
  );
}
