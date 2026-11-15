// Diálogo de confirmação genérico. `ask` devolve o id da ação escolhida, ou
// null se o usuário cancelar (Esc, clique fora ou botão Cancelar).
import { createStore } from "../lib/store";

export interface DialogAction {
  id: string;
  label: string;
  tone?: "primary" | "danger";
}

export interface DialogRequest {
  title: string;
  body?: string;
  /** Itens listados abaixo do texto (arquivos, sessões…). */
  items?: string[];
  actions: DialogAction[];
  /** Rótulo do botão de cancelar. */
  cancelLabel?: string;
}

interface Open extends DialogRequest {
  resolve: (id: string | null) => void;
}

export const dialogStore = createStore<{ open: Open | null }>({ open: null });

export function ask(req: DialogRequest): Promise<string | null> {
  // Um pedido novo cancela o anterior.
  dialogStore.get().open?.resolve(null);
  return new Promise((resolve) => {
    dialogStore.set({
      open: {
        ...req,
        resolve: (id) => {
          dialogStore.set({ open: null });
          resolve(id);
        },
      },
    });
  });
}

const fileName = (p: string) => p.split(/[/\\]/).pop() || p;

/** Pergunta padrão para arquivos com alterações não salvas. */
export async function askAboutDirty(dirty: string[], title: string, note?: string): Promise<"save" | "discard" | null> {
  const c = await ask({
    title,
    body: `As alterações destes arquivos serão perdidas se você não salvá-las.${note ? ` ${note}` : ""}`,
    items: dirty.map(fileName),
    actions: [
      { id: "save", label: "Salvar tudo", tone: "primary" },
      { id: "discard", label: "Descartar", tone: "danger" },
    ],
  });
  return c === "save" || c === "discard" ? c : null;
}
