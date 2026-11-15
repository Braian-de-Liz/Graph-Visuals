// Fechar a janela: confirma quando há arquivos não salvos ou sessões de
// agente em execução (fechar o app encerra os processos).
import { getCurrentWindow } from "@tauri-apps/api/window";
import { baseName } from "../lib/paths";
import { dirtyTabs, saveAllTabs } from "./editor";
import { ask } from "./dialog";
import { sessionsStore } from "./sessions";
import { toast } from "./ui";

export function installCloseGuard(): () => void {
  const win = getCurrentWindow();
  let allowed = false;
  const unlisten = win.onCloseRequested(async (e) => {
    if (allowed) return;
    const dirty = dirtyTabs();
    const running = sessionsStore.get().sessions.filter((s) => s.state === "running" || s.state === "starting");
    if (!dirty.length && !running.length) return;
    e.preventDefault();

    const body =
      dirty.length && running.length
        ? "Há arquivos não salvos e sessões de agente em execução. Ao sair, as sessões são encerradas."
        : dirty.length
          ? "Há arquivos com alterações não salvas."
          : "Ao sair, as sessões de agente em execução são encerradas.";
    const choice = await ask({
      title: "Sair do Graph Visuals?",
      body,
      items: [
        ...dirty.map((p) => `Não salvo: ${baseName(p)}`),
        ...running.map((s) => `Em execução: ${s.agentName} · ${s.title}`),
      ],
      actions: dirty.length
        ? [
            { id: "save", label: "Salvar e sair", tone: "primary" },
            { id: "discard", label: "Sair sem salvar", tone: "danger" },
          ]
        : [{ id: "quit", label: "Encerrar e sair", tone: "danger" }],
    });
    if (!choice) return;
    if (choice === "save" && !(await saveAllTabs())) {
      toast("Nem todos os arquivos foram salvos. A janela continua aberta.", "error");
      return;
    }
    allowed = true;
    await win.destroy();
  });
  return () => void unlisten.then((f) => f());
}
