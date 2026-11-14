// Wrappers tipados para os comandos Tauri do backend Rust.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GraphData } from "../graph/types";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface IndexEntry {
  /** Caminho relativo ao projeto, com `/`. */
  rel: string;
  isDir: boolean;
}

export interface FileIndex {
  entries: IndexEntry[];
  truncated: boolean;
}

export interface TextFile {
  content: string;
  mtime: number;
  lossy: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  command: string;
  kind: "agent" | "shell";
  path: string | null;
}

export interface GraphRunResult {
  generation: number;
  stale: boolean;
  success: boolean;
  log: string;
}

export type PtyEvent =
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null };

export interface FsChanged {
  paths: string[];
  rescan: boolean;
}

export const projectOpen = (path: string) => invoke<string>("project_open", { path });

export const fsListDir = (path: string) => invoke<DirEntry[]>("fs_list_dir", { path });
export const fsReadText = (path: string) => invoke<TextFile>("fs_read_text", { path });
export const fsStatMtime = (path: string) => invoke<number>("fs_stat_mtime", { path });
/** Cria arquivo/pasta em `parent` (aceita "a/b/c.ts"); retorna o caminho criado. */
export const fsCreate = (parent: string, name: string, isDir: boolean) => invoke<string>("fs_create", { parent, name, isDir });
export const fsRename = (path: string, newName: string) => invoke<string>("fs_rename", { path, newName });
/** Move para a Lixeira. */
export const fsDelete = (path: string) => invoke<void>("fs_delete", { path });
export const revealInOs = (path: string) => invoke<void>("reveal_in_os", { path });
/** Rejeita com `"conflict"` se o arquivo mudou no disco desde `expectedMtime`. */
export const fsWriteText = (path: string, content: string, expectedMtime: number | null) =>
  invoke<number>("fs_write_text", { path, content, expectedMtime });
export const fsIndex = (excludes: string[]) => invoke<FileIndex>("fs_index", { excludes });

export const watchStart = (excludes: string[]) => invoke<void>("watch_start", { excludes });
export const watchStop = () => invoke<void>("watch_stop");
export const onFsChanged = (cb: (e: FsChanged) => void): Promise<UnlistenFn> =>
  listen<FsChanged>("fs://changed", (e) => cb(e.payload));

export const graphifyRun = () => invoke<GraphRunResult>("graphify_run");
export const graphLoad = () => invoke<GraphData | null>("graph_load");

export const agentsDetect = () => invoke<AgentInfo[]>("agents_detect");
/** Caminho resolvido de um executável escolhido pelo usuário, ou null. */
export const agentResolve = (command: string) => invoke<string | null>("agent_resolve", { command });

export function ptySpawn(opts: {
  program: string;
  args?: string[];
  cwd?: string | null;
  cols: number;
  rows: number;
  onEvent: (e: PtyEvent) => void;
}): Promise<number> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = opts.onEvent;
  return invoke<number>("pty_spawn", {
    program: opts.program,
    args: opts.args ?? [],
    cwd: opts.cwd ?? null,
    cols: opts.cols,
    rows: opts.rows,
    onEvent: channel,
  });
}

export const ptyWrite = (id: number, data: string) => invoke<void>("pty_write", { id, data });
export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const ptyKill = (id: number) => invoke<void>("pty_kill", { id });
