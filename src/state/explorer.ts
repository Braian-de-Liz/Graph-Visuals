// Ações do explorador de arquivos (menu de contexto e atalhos da árvore),
// no padrão do VS Code: novo arquivo/pasta, renomear, excluir, copiar caminho,
// revelar no Explorador do Windows e abrir no terminal integrado.
import { createStore } from "../lib/store";
import { fsCreate, fsDelete, fsRename, revealInOs } from "../lib/ipc";
import { baseName, pathKey, toRel } from "../lib/paths";
import { projectStore } from "./project";
import { editorRenamed, openInEditor } from "./editor";
import { launchSession, sessionsStore } from "./sessions";
import { representativeNode, sceneApi, selectNode } from "./graph";
import { toast } from "./ui";
import type { MenuItem } from "../components/ContextMenu";

/** Campo de nome exibido dentro da árvore (criar ou renomear). */
export type TreeEdit =
  | { kind: "newFile" | "newFolder"; dir: string }
  | { kind: "rename"; target: string; isDir: boolean };

export const explorerStore = createStore<{
  edit: TreeEdit | null;
  confirmDelete: { path: string; isDir: boolean } | null;
}>({ edit: null, confirmDelete: null });

const refreshTree = () => projectStore.set((s) => ({ treeToken: s.treeToken + 1 }));

function ensureExpanded(absDir: string) {
  const root = projectStore.get().root;
  if (!root || pathKey(absDir) === pathKey(root)) return;
  const next = new Set(projectStore.get().expanded);
  next.add(pathKey(absDir));
  projectStore.set({ expanded: next });
}

export function startCreate(kind: "newFile" | "newFolder", dir: string) {
  ensureExpanded(dir);
  explorerStore.set({ edit: { kind, dir } });
}

export function startRename(target: string, isDir: boolean) {
  explorerStore.set({ edit: { kind: "rename", target, isDir } });
}

export const cancelEdit = () => explorerStore.set({ edit: null });

/** Confirma o campo de nome. Retorna false (mantendo o campo) se der erro. */
export async function commitEdit(name: string): Promise<boolean> {
  const edit = explorerStore.get().edit;
  name = name.trim();
  if (!edit) return true;
  if (!name) {
    cancelEdit();
    return true;
  }
  try {
    if (edit.kind === "rename") {
      if (name === baseName(edit.target)) {
        cancelEdit();
        return true;
      }
      const next = await fsRename(edit.target, name);
      // Abas abertas no editor acompanham o novo nome (sem perder edições).
      editorRenamed(edit.target, next);
    } else {
      const created = await fsCreate(edit.dir, name, edit.kind === "newFolder");
      if (edit.kind === "newFile") openInEditor(created);
      projectStore.set({ revealed: created });
    }
    cancelEdit();
    refreshTree();
    return true;
  } catch (e) {
    toast(String(e), "error");
    return false;
  }
}

export const requestDelete = (path: string, isDir: boolean) => explorerStore.set({ confirmDelete: { path, isDir } });

export async function confirmDelete() {
  const c = explorerStore.get().confirmDelete;
  explorerStore.set({ confirmDelete: null });
  if (!c) return;
  try {
    await fsDelete(c.path);
    toast(`${baseName(c.path)} movido para a Lixeira`);
    refreshTree();
  } catch (e) {
    toast(`Não foi possível excluir: ${e}`, "error");
  }
}

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast(`${what} copiado`),
    () => toast("Não foi possível acessar a área de transferência", "error"),
  );
}

function openTerminalIn(dir: string) {
  const shell = sessionsStore.get().agents.find((a) => a.kind === "shell" && a.path);
  if (!shell) return toast("Nenhum shell encontrado no PATH", "error");
  launchSession(shell, dir);
}

function locateInGraph(abs: string) {
  const root = projectStore.get().root;
  const rel = root ? toRel(root, abs) : null;
  const idx = rel ? representativeNode(rel) : null;
  if (idx === null) return toast("Este arquivo não tem nó no grafo");
  selectNode(idx);
  sceneApi()?.focusNodes([idx]);
}

/** Itens do menu para um arquivo/pasta da árvore, ou para a raiz (`entry` nulo). */
export function menuFor(entry: { path: string; isDir: boolean } | null, onOpenFile: (p: string) => void): MenuItem[] {
  const root = projectStore.get().root;
  if (!root) return [];
  const path = entry?.path ?? root;
  const isDir = entry ? entry.isDir : true;
  const dir = isDir ? path : path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))) || root;
  const rel = toRel(root, path) ?? "";
  const items: MenuItem[] = [];

  if (entry && !isDir) {
    items.push({ label: "Abrir", run: () => onOpenFile(path) });
    items.push({ label: "Localizar no grafo", run: () => locateInGraph(path) });
    items.push("separator");
  }
  items.push({ label: "Novo arquivo…", run: () => startCreate("newFile", dir) });
  items.push({ label: "Nova pasta…", run: () => startCreate("newFolder", dir) });
  items.push("separator");
  items.push({ label: "Revelar no Explorador de Arquivos", hint: "Shift+Alt+R", run: () => void revealInOs(path).catch((e) => toast(String(e), "error")) });
  items.push({ label: "Abrir no terminal integrado", run: () => openTerminalIn(dir) });
  items.push("separator");
  items.push({ label: "Copiar caminho", hint: "Shift+Alt+C", run: () => copy(path, "Caminho") });
  items.push({ label: "Copiar caminho relativo", disabled: !entry, run: () => copy(rel, "Caminho relativo") });
  if (entry) {
    items.push("separator");
    items.push({ label: "Renomear…", hint: "F2", run: () => startRename(path, isDir) });
    items.push({ label: "Excluir", hint: "Delete", danger: true, run: () => requestDelete(path, isDir) });
  } else {
    items.push("separator");
    items.push({ label: "Recolher pastas", run: () => projectStore.set({ expanded: new Set(), revealed: null }) });
  }
  return items;
}

/** Atalhos com o foco num item da árvore (como no VS Code). */
export function treeItemKey(e: React.KeyboardEvent, entry: { path: string; isDir: boolean }) {
  const k = e.key;
  if (k === "F2") startRename(entry.path, entry.isDir);
  else if (k === "Delete") requestDelete(entry.path, entry.isDir);
  else if (e.shiftKey && e.altKey && e.code === "KeyR") void revealInOs(entry.path);
  else if (e.shiftKey && e.altKey && e.code === "KeyC") copy(entry.path, "Caminho");
  else return;
  e.preventDefault();
  e.stopPropagation();
}
