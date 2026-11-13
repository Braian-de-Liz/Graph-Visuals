import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Icon } from "./Icons";
import { attachTerminal, focusTerminal, sendLine, type SessionMeta } from "../state/sessions";

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
