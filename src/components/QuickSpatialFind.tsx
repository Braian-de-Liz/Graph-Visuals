// Ctrl + P: pesquisa de arquivos integrada à navegação no grafo.
// Ctrl + Shift + P (ou ">" no início): comandos da aplicação.
//
// Localizar um resultado move a câmera até o nó e pede confirmação; o editor
// nunca abre automaticamente.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { fuzzyMatch, matchPath } from "../lib/fuzzy";
import { baseName, dirName, joinRel, toRel } from "../lib/paths";
import type { GraphData } from "../graph/types";
import {
  graphStore,
  nodesOfFile,
  nodesUnderDir,
  representativeNode,
  runAnalysis,
  sceneApi,
  selectNode,
} from "../state/graph";
import { projectStore, revealInTree } from "../state/project";
import { uiStore, type FindMode, type LocateResult } from "../state/ui";
import { editorGoToLine, editorStore, openInEditor, parseLine, showEditor } from "../state/editor";
import { KEYBINDINGS, formatKeys } from "../lib/keybindings";

interface FileItem {
  type: "file" | "dir";
  rel: string;
  score: number;
  positions: number[];
  hasNode: boolean;
}
interface SymbolItem {
  type: "symbol";
  index: number;
  label: string;
  rel: string | null;
  location: string | null;
  score: number;
  positions: number[];
  /** Busca "@": abre direto no arquivo, sem localizar no grafo. */
  direct?: boolean;
}
interface LineItem {
  type: "line";
  line: number;
  score: number;
  positions: number[];
}
interface CommandItem {
  type: "command";
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  score: number;
  positions: number[];
}
type Item = FileItem | SymbolItem | CommandItem | LineItem;

const MAX_FILES = 40;
const MAX_SYMBOLS = 8;

function commands(): Omit<CommandItem, "score" | "positions">[] {
  const extra: Omit<CommandItem, "score" | "positions">[] = [
    { type: "command", id: "regen", label: "Regenerar grafo (Graphify)", run: () => void runAnalysis() },
    { type: "command", id: "clear", label: "Grafo: limpar seleção", hint: "Esc", run: () => selectNode(null) },
    { type: "command", id: "editor", label: "Mostrar editor", run: showEditor },
  ];
  const fromBindings = KEYBINDINGS.filter((b) => b.id !== "commands").map((b) => ({
    type: "command" as const,
    id: b.id,
    label: b.label,
    hint: b.keys[0] ? formatKeys(b.keys[0]) : undefined,
    run: b.run,
  }));
  return [...fromBindings, ...extra];
}

const PREFIX: Record<FindMode, string> = { files: "", commands: ">", symbols: "#", fileSymbols: "@", line: ":" };

/** Executa a localização espacial de um resultado e abre a confirmação. */
export function locate(item: FileItem | SymbolItem) {
  const graph = graphStore.get().graph;
  let result: LocateResult;
  if (item.type === "symbol") {
    selectNode(item.index);
    sceneApi()?.focusNodes([item.index]);
    result = { kind: "symbol", rel: item.rel ?? "", nodeIndex: item.index, line: parseLine(item.location), label: item.label };
  } else if (item.type === "dir") {
    const nodes = graph ? nodesUnderDir(item.rel) : [];
    if (nodes.length) sceneApi()?.focusNodes(nodes);
    selectNode(null);
    result = { kind: "dir", rel: item.rel, nodeIndex: nodes.length ? nodes[0] : null, line: null, label: baseName(item.rel) };
  } else {
    const idx = graph ? representativeNode(item.rel) : null;
    if (idx !== null) {
      selectNode(idx);
      sceneApi()?.focusNodes([idx]);
    }
    result = { kind: "file", rel: item.rel, nodeIndex: idx, line: null, label: baseName(item.rel) };
  }
  uiStore.set({ locate: result, find: null });
}

function Highlight({ text, positions, offset = 0 }: { text: string; positions: number[]; offset?: number }) {
  const set = new Set(positions.map((p) => p - offset));
  const out: ReactNode[] = [];
  let buf = "";
  let inMatch = false;
  const flush = (k: number) => {
    if (!buf) return;
    out.push(inMatch ? <mark key={k}>{buf}</mark> : <span key={k}>{buf}</span>);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== inMatch) {
      flush(i);
      inMatch = m;
    }
    buf += text[i];
  }
  flush(text.length);
  return <>{out}</>;
}

export function QuickSpatialFind() {
  const mode = uiStore.use((s) => s.find);
  if (!mode) return null;
  return <FindDialog key={mode} initialMode={mode} />;
}

function searchSymbols(q: string, graph: GraphData, onlyRel: string | null, limit: number): SymbolItem[] {
  const out: SymbolItem[] = [];
  const onlyKey = onlyRel?.toLowerCase();
  graph.nodes.forEach((n, i) => {
    if (onlyKey !== undefined) {
      if (n.sourceFile?.toLowerCase() !== onlyKey) return;
    } else if (n.sourceFile && baseName(n.sourceFile) === n.label) return; // nós de arquivo aparecem como arquivos
    const m = fuzzyMatch(q, n.label);
    if (m && (m.score > 0 || !q))
      out.push({ type: "symbol", index: i, label: n.label, rel: n.sourceFile, location: n.sourceLocation, score: m.score, positions: m.positions, direct: onlyKey !== undefined });
  });
  if (q) out.sort((a, b) => b.score - a.score);
  else out.sort((a, b) => (parseLine(a.location) ?? 0) - (parseLine(b.location) ?? 0));
  return out.slice(0, limit);
}

function FindDialog({ initialMode }: { initialMode: FindMode }) {
  const [query, setQuery] = useState(PREFIX[initialMode]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const index = projectStore.use((s) => s.index);
  const truncated = projectStore.use((s) => s.indexTruncated);
  const root = projectStore.use((s) => s.root);
  const graph = graphStore.use((s) => s.graph);
  const openPath = editorStore.use((s) => s.openPath);
  const deferred = useDeferredValue(query);

  useEffect(() => inputRef.current?.focus(), []);

  const prefix = deferred[0];
  const isCommand = prefix === ">";
  const items = useMemo<Item[]>(() => {
    if (isCommand) {
      const q = deferred.slice(1).trim();
      return commands()
        .map((c) => {
          const m = fuzzyMatch(q, c.label);
          return m ? { ...c, score: m.score, positions: m.positions } : null;
        })
        .filter((x): x is CommandItem => !!x)
        .sort((a, b) => (q ? b.score - a.score : 0));
    }
    if (prefix === ":") {
      const n = parseInt(deferred.slice(1), 10);
      if (!openPath) return [];
      return Number.isFinite(n) && n > 0 ? [{ type: "line" as const, line: n, score: 0, positions: [] }] : [];
    }
    if (prefix === "#") {
      return graph ? searchSymbols(deferred.slice(1).trim(), graph, null, 60) : [];
    }
    if (prefix === "@") {
      const rel = openPath && root ? toRel(root, openPath) : null;
      return graph && rel ? searchSymbols(deferred.slice(1).trim(), graph, rel, 200) : [];
    }
    const q = deferred.trim();
    if (!q) {
      return index
        .filter((e) => !e.isDir)
        .slice(0, MAX_FILES)
        .map((e) => ({ type: "file" as const, rel: e.rel, score: 0, positions: [], hasNode: nodesOfFile(e.rel).length > 0 }));
    }
    const files: FileItem[] = [];
    for (const e of index) {
      const m = matchPath(q, e.rel);
      if (m) files.push({ type: e.isDir ? "dir" : "file", rel: e.rel, score: m.score - (e.isDir ? 50 : 0), positions: m.positions, hasNode: false });
    }
    files.sort((a, b) => b.score - a.score);
    const topFiles = files.slice(0, MAX_FILES);
    for (const f of topFiles) f.hasNode = f.type === "dir" ? nodesUnderDir(f.rel).length > 0 : nodesOfFile(f.rel).length > 0;

    const symbols = graph && q.length >= 2 ? searchSymbols(q, graph, null, MAX_SYMBOLS) : [];
    return [...topFiles, ...symbols];
  }, [deferred, isCommand, prefix, index, graph, openPath, root]);

  useEffect(() => setActive(0), [deferred]);
  useEffect(() => {
    listRef.current?.querySelector(".find-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => uiStore.set({ find: null });
  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.type === "command") {
      close();
      item.run();
    } else if (item.type === "line") {
      close();
      editorGoToLine(item.line);
    } else if (item.type === "symbol" && item.direct) {
      // "@": vai direto à linha no arquivo aberto, como no VS Code.
      close();
      selectNode(item.index);
      editorGoToLine(parseLine(item.location) ?? 1);
    } else {
      locate(item);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    }
  };

  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="find glass-strong" onMouseDown={(e) => e.stopPropagation()}>
        <div className="find-input">
          <Icon name={isCommand ? "chevronRight" : "search"} size={18} />
          <input
            ref={inputRef}
            value={query}
            spellCheck={false}
            placeholder={
              prefix === ":"
                ? openPath ? "Número da linha" : "Abra um arquivo no editor"
                : prefix === "@"
                  ? openPath ? "Símbolo no arquivo aberto" : "Abra um arquivo no editor"
                  : prefix === "#"
                    ? "Símbolo no projeto"
                    : root
                      ? "Buscar arquivos  ( > comandos · # símbolos · @ no arquivo · : linha )"
                      : "Digite > para comandos"
            }
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="find-results" ref={listRef}>
          {items.length === 0 && (
            <div className="find-empty">
              {prefix === ":" && openPath ? "Digite o número da linha." : root || isCommand ? "Nenhum resultado." : "Abra um projeto para pesquisar arquivos."}
            </div>
          )}
          {items.map((item, i) => {
            const group =
              item.type === "command"
                ? "Comandos"
                : item.type === "line"
                  ? "Ir para"
                  : item.type === "symbol"
                    ? item.direct ? "Símbolos no arquivo" : "Símbolos no grafo"
                    : "Arquivos";
            const header = group !== lastGroup ? <div className="find-group">{group}</div> : null;
            lastGroup = group;
            return (
              <div key={item.type === "symbol" ? `s${item.index}` : item.type === "command" ? item.id : item.type === "line" ? "line" : item.rel}>
                {header}
                <div
                  className={`find-item ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <ResultRow item={item} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="find-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> localizar no grafo</span>
          {truncated && <span className="warn">índice limitado a 200.000 entradas</span>}
        </div>
      </div>
    </div>
  );
}

function ResultRow({ item }: { item: Item }) {
  if (item.type === "line") {
    return (
      <>
        <Icon name="chevronRight" />
        <span className="find-name">Ir para a linha {item.line}</span>
      </>
    );
  }
  if (item.type === "command") {
    return (
      <>
        <Icon name="chevronRight" />
        <span className="find-name">
          <Highlight text={item.label} positions={item.positions} />
        </span>
        {item.hint && <kbd className="find-hint">{item.hint}</kbd>}
      </>
    );
  }
  if (item.type === "symbol") {
    return (
      <>
        <Icon name="dot" className="arc" />
        <span className="find-name">
          <Highlight text={item.label} positions={item.positions} />
        </span>
        <span className="find-path">
          {item.rel}
          {item.location ? `:${item.location}` : ""}
        </span>
      </>
    );
  }
  const slash = item.rel.lastIndexOf("/");
  const name = item.rel.slice(slash + 1);
  const dir = dirName(item.rel);
  return (
    <>
      <Icon name={item.type === "dir" ? "folder" : "file"} />
      <span className="find-name">
        <Highlight text={name} positions={item.positions} offset={slash + 1} />
      </span>
      <span className="find-path">
        <Highlight text={dir} positions={item.positions} />
      </span>
      {item.hasNode ? <span className="badge arc">no grafo</span> : <span className="badge">sem nó</span>}
    </>
  );
}

/** Confirmação após localizar: o usuário decide se abre o arquivo. */
export function LocateConfirm() {
  const loc = uiStore.use((s) => s.locate);
  const root = projectStore.use((s) => s.root);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (loc) btnRef.current?.focus();
  }, [loc]);
  if (!loc) return null;

  const cancel = () => uiStore.set({ locate: null });
  const primary = () => {
    if (!root) return;
    if (loc.kind === "dir") {
      revealInTree(loc.rel);
      uiStore.set({ rightOpen: true, rightHidden: false, locate: null });
    } else {
      openInEditor(joinRel(root, loc.rel), loc.line);
      uiStore.set({ locate: null });
    }
  };

  const title =
    loc.kind === "dir"
      ? loc.nodeIndex !== null
        ? "Diretório localizado no grafo."
        : "Diretório sem representação no grafo."
      : loc.nodeIndex !== null
        ? `${loc.kind === "symbol" ? "Símbolo" : "Arquivo"} encontrado. Deseja abrir?`
        : "Arquivo sem representação no grafo. Deseja abrir mesmo assim?";

  return (
    <div className="locate glass-strong" role="dialog" onKeyDown={(e) => e.key === "Escape" && cancel()}>
      <div className={`locate-mark ${loc.nodeIndex !== null ? "found" : ""}`}>
        <Icon name={loc.kind === "dir" ? "folder" : loc.nodeIndex !== null ? "target" : "file"} size={18} />
      </div>
      <div className="locate-text">
        <strong>{title}</strong>
        <span title={loc.rel}>
          {loc.kind === "symbol" ? `${loc.label} · ${loc.rel}` : loc.rel || loc.label}
        </span>
      </div>
      <button ref={btnRef} className="btn btn-primary" onClick={primary}>
        {loc.kind === "dir" ? "Revelar no explorador" : "Abrir arquivo"}
      </button>
      <button className="btn" onClick={cancel}>
        Cancelar
      </button>
    </div>
  );
}
