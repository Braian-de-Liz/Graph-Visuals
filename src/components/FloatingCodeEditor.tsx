// Editor flutuante (CodeMirror 6). Aparece sob demanda; o grafo continua
// sendo o ambiente principal. Estados: compacto, expandido e maximizado.
//
// Abas: um único EditorView; cada aba inativa guarda o próprio EditorState
// (texto, seleção e histórico de desfazer), restaurado ao voltar para ela.
import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { Icon } from "./Icons";
import { openContextMenu } from "./ContextMenu";
import { gvHighlight, gvTheme, languageFor } from "../editor/codemirror";
import { importLinks } from "../editor/importLinks";
import { fsReadText, fsStatMtime, fsWriteText, onFsChanged } from "../lib/ipc";
import { baseName, pathKey, toRel } from "../lib/paths";
import {
  editorStore,
  isMarkdown,
  openInEditor,
  registerEditorHandlers,
  resolveDirtyTabs,
  type EditorMode,
  type EditorTab,
  type MarkdownView,
} from "../state/editor";
import { MarkdownPreview } from "./MarkdownPreview";
import { projectStore } from "../state/project";
import { toast } from "../state/ui";
import { ask, askAboutDirty } from "../state/dialog";
import { markSelfWrite } from "../state/activity";
import { settingsStore } from "../state/settings";

/** Ctrl+Shift+Enter (VS Code): insere uma linha acima e move o cursor para ela. */
function insertLineAbove(view: EditorView): boolean {
  const changes = view.state.changeByRange((range) => {
    const line = view.state.doc.lineAt(range.head);
    const indent = /^\s*/.exec(line.text)![0];
    return {
      changes: { from: line.from, insert: indent + view.state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

type Banner = { kind: "conflict-save" } | { kind: "conflict-external" } | { kind: "deleted" } | { kind: "close" };

/** Estado guardado de uma aba inativa. */
interface Stash {
  state: EditorState;
  mtime: number | null;
  readOnly: boolean;
  scroll: number;
}

const sameKey = (a: string | null, b: string | null) => !!a && !!b && pathKey(a) === pathKey(b);

function setTabDirty(path: string, dirty: boolean) {
  editorStore.set((s) => ({ tabs: s.tabs.map((t) => (sameKey(t.path, path) ? { ...t, dirty } : t)) }));
}

export function FloatingCodeEditor() {
  const visible = editorStore.use((s) => s.visible);
  const mode = editorStore.use((s) => s.mode);
  const openPath = editorStore.use((s) => s.openPath);
  const dirty = editorStore.use((s) => s.dirty);
  const tabs = editorStore.use((s) => s.tabs);
  const mdView = editorStore.use((s) => s.mdView);
  const isMd = isMarkdown(openPath);
  // Texto do Markdown aberto, para a prévia (atualizado a cada edição).
  const [mdSource, setMdSource] = useState("");
  const isMdRef = useRef(false);
  isMdRef.current = isMd;
  const token = editorStore.use((s) => s.requestToken);
  const root = projectStore.use((s) => s.root);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mtimeRef = useRef<number | null>(null);
  const pathRef = useRef<string | null>(null);
  const langComp = useRef(new Compartment());
  const roComp = useRef(new Compartment());
  const saveRef = useRef<(force?: boolean, auto?: boolean) => Promise<boolean>>(async () => false);
  const loadingRef = useRef(false);
  // Salvamento automático: contador de edições, timer e estado atual (para callbacks do CodeMirror).
  const changeSeqRef = useRef(0);
  const autoTimerRef = useRef(0);
  const savingRef = useRef(false);
  /** Gravação em andamento: trocar de aba espera por ela. */
  const savePromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const scheduleRef = useRef<() => void>(() => {});
  const bannerRef = useRef<Banner | null>(null);
  const readOnlyRef = useRef(false);
  const stashRef = useRef(new Map<string, Stash>());
  /** Fila de trocas de aba: pedidos rápidos são aplicados em ordem. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const activateRef = useRef<(path: string, line: number | null) => Promise<void>>(async () => {});
  const restoreRef = useRef<(path: string, line: number | null) => Promise<void>>(async () => {});

  const [banner, setBanner] = useState<Banner | null>(null);
  const [readOnly, setReadOnlyState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const setReadOnly = (v: boolean) => {
    readOnlyRef.current = v;
    setReadOnlyState(v);
  };
  const enqueue = (op: () => Promise<void>) => {
    chainRef.current = chainRef.current.then(op, op);
  };

  // --- criação do EditorView (uma vez) ---
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({ doc: "", extensions: baseExtensions() }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function baseExtensions() {
    return [
      basicSetup,
      importLinks(() => pathRef.current),
      gvTheme,
      gvHighlight,
      langComp.current.of([]),
      roComp.current.of(EditorState.readOnly.of(false)),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (void saveRef.current(), true) }]),
      // Complementos no padrão VS Code (o restante já vem do basicSetup).
      Prec.high(
        keymap.of([
          { key: "Mod-h", run: openSearchPanel, preventDefault: true },
          { key: "Mod-Shift-Enter", run: insertLineAbove, preventDefault: true },
          indentWithTab,
        ]),
      ),
      EditorView.clickAddsSelectionRange.of((e) => e.altKey),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !loadingRef.current) {
          changeSeqRef.current++;
          if (!editorStore.get().dirty) editorStore.set({ dirty: true });
          scheduleRef.current();
          if (isMdRef.current) setMdSource(u.state.doc.toString());
        }
        if (u.selectionSet || u.docChanged) updateCursor(u.state);
      }),
      // Ao sair do editor, salva na hora (como o "onFocusChange" do VS Code).
      EditorView.domEventHandlers({
        blur: () => {
          if (settingsStore.get().autoSave) {
            clearTimeout(autoTimerRef.current);
            void saveRef.current(false, true);
          }
          return false;
        },
      }),
    ];
  }

  function updateCursor(state: EditorState) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    setCursor({ line: line.number, col: head - line.from + 1 });
  }

  /** Guarda a aba ativa para restaurá-la depois. */
  function stashCurrent() {
    const view = viewRef.current;
    const path = pathRef.current;
    if (!view || !path) return;
    clearTimeout(autoTimerRef.current);
    stashRef.current.set(pathKey(path), {
      state: view.state,
      mtime: mtimeRef.current,
      readOnly: readOnlyRef.current,
      scroll: view.scrollDOM.scrollTop,
    });
  }

  /** Lê o arquivo do disco e o mostra (nova aba, ou recarrega a ativa com `keepView`). */
  async function load(path: string, line: number | null, keepView = false) {
    const view = viewRef.current;
    if (!view) return;
    setLoading(true);
    try {
      const file = await fsReadText(path);
      const lang = await languageFor(path);
      if (!keepView && pathRef.current && !sameKey(pathRef.current, path)) stashCurrent();
      const prevSel = keepView ? view.state.selection.main.head : 0;
      const prevScroll = keepView ? view.scrollDOM.scrollTop : 0;
      loadingRef.current = true;
      view.setState(EditorState.create({ doc: file.content, extensions: baseExtensions() }));
      view.dispatch({
        effects: [
          langComp.current.reconfigure(lang ?? []),
          roComp.current.reconfigure(EditorState.readOnly.of(file.lossy)),
        ],
      });
      loadingRef.current = false;
      mtimeRef.current = file.mtime;
      pathRef.current = path;
      stashRef.current.delete(pathKey(path));
      setReadOnly(file.lossy);
      setBanner(null);
      editorStore.set((s) => ({
        openPath: path,
        dirty: false,
        tabs: s.tabs.some((t) => sameKey(t.path, path)) ? s.tabs : [...s.tabs, { path, dirty: false }],
      }));
      setMdSource(isMarkdown(path) ? file.content : "");
      if (keepView) {
        const pos = Math.min(prevSel, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos } });
        view.scrollDOM.scrollTop = prevScroll;
      } else {
        goToLine(line);
      }
      updateCursor(view.state);
    } catch (e) {
      loadingRef.current = false;
      toast(`Não foi possível abrir ${baseName(path)}: ${e}`, "error");
      if (!pathRef.current) editorStore.set({ visible: false });
    } finally {
      setLoading(false);
    }
  }

  /** Volta para uma aba guardada e confere se o arquivo mudou no disco. */
  async function restore(path: string, line: number | null) {
    const view = viewRef.current;
    const key = pathKey(path);
    const st = stashRef.current.get(key);
    if (!view) return;
    if (!st) return load(path, line);
    stashCurrent();
    stashRef.current.delete(key);
    loadingRef.current = true;
    view.setState(st.state);
    loadingRef.current = false;
    mtimeRef.current = st.mtime;
    pathRef.current = path;
    setReadOnly(st.readOnly);
    setBanner(null);
    const tabDirty = editorStore.get().tabs.find((t) => sameKey(t.path, path))?.dirty ?? false;
    editorStore.set({ openPath: path, dirty: tabDirty });
    setMdSource(isMarkdown(path) ? st.state.doc.toString() : "");
    updateCursor(st.state);
    if (line) goToLine(line);
    else {
      view.scrollDOM.scrollTop = st.scroll;
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = st.scroll;
        view.focus();
      });
    }
    try {
      const mtime = await fsStatMtime(path);
      if (!sameKey(pathRef.current, path) || mtime === mtimeRef.current) return;
      if (editorStore.get().dirty) setBanner({ kind: "conflict-external" });
      else await load(path, null, true);
    } catch {
      if (sameKey(pathRef.current, path)) setBanner({ kind: "deleted" });
    }
  }
  restoreRef.current = restore;

  /** Abre `path` (aba existente ou nova). */
  async function activate(path: string, line: number | null) {
    await savePromiseRef.current;
    if (sameKey(pathRef.current, path)) {
      goToLine(line);
      return;
    }
    // Com salvamento automático, a aba que sai é gravada antes da troca.
    if (pathRef.current && editorStore.get().dirty && settingsStore.get().autoSave && !bannerRef.current) {
      clearTimeout(autoTimerRef.current);
      await saveRef.current(false, true);
    }
    if (stashRef.current.has(pathKey(path))) await restore(path, line);
    else await load(path, line);
  }
  activateRef.current = activate;

  function goToLine(line: number | null) {
    const view = viewRef.current;
    if (!view) return;
    const n = Math.max(1, Math.min(line ?? 1, view.state.doc.lines));
    const l = view.state.doc.line(n);
    view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: line ? "center" : "start" }) });
    requestAnimationFrame(() => view.focus());
  }

  /**
   * Grava a aba ativa. `auto`: salvamento automático, sem aviso, e ignorado
   * enquanto houver um conflito pendente. Retorna true se gravou.
   */
  async function save(force = false, auto = false): Promise<boolean> {
    const view = viewRef.current;
    const path = pathRef.current;
    if (!view || !path || readOnlyRef.current) return false;
    if (auto && (bannerRef.current || savingRef.current || !editorStore.get().dirty)) return false;
    const seq = changeSeqRef.current;
    const text = view.state.doc.toString();
    savingRef.current = true;
    try {
      const r = root ? toRel(root, path) : null;
      if (r) markSelfWrite(r);
      const mtime = await fsWriteText(path, text, force ? null : mtimeRef.current);
      if (!sameKey(pathRef.current, path)) {
        // Trocou de aba durante a gravação: atualiza a aba guardada.
        const st = stashRef.current.get(pathKey(path));
        if (st) {
          st.mtime = mtime;
          if (st.state.doc.toString() === text) setTabDirty(path, false);
        }
        return true;
      }
      mtimeRef.current = mtime;
      // Digitou durante a gravação: continua "sujo" e agenda outra.
      if (changeSeqRef.current === seq) editorStore.set({ dirty: false });
      else scheduleAutoSave();
      setBanner(null);
      if (!auto) toast(`${baseName(path)} salvo`);
      return true;
    } catch (e) {
      if (!sameKey(pathRef.current, path)) toast(`Falha ao salvar ${baseName(path)}: ${e}`, "error");
      else if (String(e) === "conflict") setBanner({ kind: "conflict-save" });
      else toast(`Falha ao salvar: ${e}`, "error");
      return false;
    } finally {
      savingRef.current = false;
    }
  }
  saveRef.current = (force, auto) => {
    const p = save(force, auto);
    savePromiseRef.current = p.catch(() => false);
    return p;
  };

  /** Grava uma aba inativa a partir do estado guardado. */
  async function saveStashed(path: string): Promise<boolean> {
    const st = stashRef.current.get(pathKey(path));
    if (!st) return true;
    try {
      const r = root ? toRel(root, path) : null;
      if (r) markSelfWrite(r);
      st.mtime = await fsWriteText(path, st.state.doc.toString(), st.mtime);
      setTabDirty(path, false);
      return true;
    } catch (e) {
      toast(
        String(e) === "conflict"
          ? `${baseName(path)} foi alterado fora do editor. Abra a aba para resolver.`
          : `Falha ao salvar ${baseName(path)}: ${e}`,
        "error",
      );
      return false;
    }
  }

  function scheduleAutoSave() {
    clearTimeout(autoTimerRef.current);
    const { autoSave, autoSaveDelay } = settingsStore.get();
    if (!autoSave) return;
    autoTimerRef.current = window.setTimeout(() => void saveRef.current(false, true), autoSaveDelay);
  }
  scheduleRef.current = scheduleAutoSave;
  bannerRef.current = banner;

  // --- pedidos de abertura ---
  useEffect(() => {
    const { requestedPath, requestedLine } = editorStore.get();
    if (!requestedPath) return;
    enqueue(() => activateRef.current(requestedPath, requestedLine));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // --- alterações externas (aba ativa; as inativas são conferidas ao voltar) ---
  useEffect(() => {
    const un = onFsChanged(async (e) => {
      const path = pathRef.current;
      if (!path) return;
      const key = pathKey(path);
      if (!e.rescan && !e.paths.some((p) => pathKey(p) === key)) return;
      try {
        const mtime = await fsStatMtime(path);
        if (!sameKey(pathRef.current, path) || mtime === mtimeRef.current) return; // gravação nossa ou sem mudança
        if (editorStore.get().dirty) setBanner({ kind: "conflict-external" });
        else void load(path, null, true);
      } catch {
        if (sameKey(pathRef.current, path)) setBanner({ kind: "deleted" });
      }
    });
    return () => {
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Projeto trocado: fecha os arquivos do projeto anterior (a troca já
  // passou por `resolveDirtyTabs`).
  useEffect(() => {
    const outside = editorStore.get().tabs.some((t) => !root || toRel(root, t.path) === null);
    if (outside) closeNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  /** Fecha todas as abas. */
  function closeNow() {
    clearTimeout(autoTimerRef.current);
    pathRef.current = null;
    mtimeRef.current = null;
    stashRef.current.clear();
    setBanner(null);
    loadingRef.current = true;
    viewRef.current?.setState(EditorState.create({ doc: "", extensions: baseExtensions() }));
    loadingRef.current = false;
    editorStore.set({ openPath: null, dirty: false, tabs: [], visible: false, mode: "compact" });
  }

  /** Fecha a aba ativa sem perguntar e mostra a vizinha. */
  function closeActiveNow() {
    const path = pathRef.current;
    if (!path) return;
    const { tabs } = editorStore.get();
    const idx = tabs.findIndex((t) => sameKey(t.path, path));
    const rest = tabs.filter((_, i) => i !== idx);
    if (!rest.length) return closeNow();
    clearTimeout(autoTimerRef.current);
    pathRef.current = null; // a aba fechada não é guardada
    setBanner(null);
    editorStore.set({ tabs: rest });
    const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
    enqueue(() => restoreRef.current(next.path, null));
  }

  const requestClose = () => {
    if (!editorStore.get().dirty) return closeActiveNow();
    if (settingsStore.get().autoSave && !bannerRef.current) {
      clearTimeout(autoTimerRef.current);
      void saveRef.current(false, true).then((ok) => (ok ? closeActiveNow() : setBanner({ kind: "close" })));
    } else setBanner({ kind: "close" });
  };

  async function closeTab(path: string) {
    if (sameKey(pathRef.current, path)) return requestClose();
    const tab = editorStore.get().tabs.find((t) => sameKey(t.path, path));
    if (!tab) return;
    if (tab.dirty) {
      const c = await ask({
        title: `Salvar as alterações em ${baseName(path)}?`,
        body: "As alterações serão perdidas se você não salvá-las.",
        actions: [
          { id: "save", label: "Salvar", tone: "primary" },
          { id: "discard", label: "Não salvar", tone: "danger" },
        ],
      });
      if (!c) return;
      if (c === "save" && !(await saveStashed(path))) return;
    }
    stashRef.current.delete(pathKey(path));
    editorStore.set((s) => ({ tabs: s.tabs.filter((t) => !sameKey(t.path, path)) }));
  }

  async function saveAll(): Promise<boolean> {
    let ok = true;
    if (pathRef.current && editorStore.get().dirty) ok = (await saveRef.current(false, false)) && ok;
    for (const t of editorStore.get().tabs) {
      if (t.dirty && !sameKey(t.path, pathRef.current)) ok = (await saveStashed(t.path)) && ok;
    }
    return ok && !editorStore.get().tabs.some((t) => t.dirty);
  }

  function renamed(oldPath: string, newPath: string) {
    const oldKey = pathKey(oldPath);
    const map = (p: string) => {
      const k = pathKey(p);
      return k === oldKey || k.startsWith(oldKey + "/") ? newPath + p.slice(oldPath.length) : p;
    };
    for (const [k, st] of [...stashRef.current]) {
      if (k === oldKey || k.startsWith(oldKey + "/")) {
        stashRef.current.delete(k);
        stashRef.current.set(pathKey(newPath + k.slice(oldKey.length)), st);
      }
    }
    if (pathRef.current) pathRef.current = map(pathRef.current);
    editorStore.set((s) => ({
      openPath: s.openPath ? map(s.openPath) : null,
      tabs: s.tabs.map((t) => ({ ...t, path: map(t.path) })),
    }));
  }

  const handlersRef = useRef({ requestClose, closeTab, saveAll, closeNow, renamed });
  handlersRef.current = { requestClose, closeTab, saveAll, closeNow, renamed };
  useEffect(() => {
    const h = handlersRef;
    registerEditorHandlers({
      save: () => {
        if (pathRef.current && editorStore.get().visible) void saveRef.current();
      },
      close: () => {
        if (pathRef.current) h.current.requestClose();
      },
      closeTab: (p) => void h.current.closeTab(p),
      saveAll: () => h.current.saveAll(),
      closeAll: () => h.current.closeNow(),
      renamed: (a, b) => h.current.renamed(a, b),
    });
    return () => {
      registerEditorHandlers(null);
    };
  }, []);

  const setMode = (m: EditorMode) => {
    editorStore.set({ mode: m });
    if (m === "maximized") setOffset({ x: 0, y: 0 });
  };

  // --- arrastar pela barra de título ---
  const startDrag = (e: React.PointerEvent) => {
    if (mode === "maximized" || (e.target as HTMLElement).closest("button")) return;
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    const move = (ev: PointerEvent) => setOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const closeOthers = async (keep: string) => {
    for (const t of editorStore.get().tabs) if (!sameKey(t.path, keep)) await closeTab(t.path);
  };
  const closeAllTabs = async () => {
    const ok = await resolveDirtyTabs((d) => askAboutDirty(d, "Fechar todos os arquivos?"));
    if (ok) closeNow();
  };

  const rel = openPath && root ? toRel(root, openPath) : openPath;
  const style = mode === "maximized" ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px)` };

  return (
    <div className={`code-editor glass-strong mode-${mode} ${visible ? "shown" : "hidden"}`} style={style}>
      <header className="editor-titlebar" onPointerDown={startDrag} onDoubleClick={() => setMode(mode === "maximized" ? "expanded" : "maximized")}>
        <Icon name="code" className="arc" />
        <div className="editor-file">
          <strong>
            {openPath ? baseName(openPath) : "Editor"}
            {dirty && <span className="dirty-dot" title="Alterações não salvas" />}
          </strong>
          <span title={openPath ?? ""}>{rel}</span>
        </div>
        <span className="spacer" />
        {readOnly && <span className="badge red">somente leitura · não UTF-8</span>}
        {loading && <span className="badge">carregando…</span>}
        {isMd && <MarkdownViewSwitch value={mdView} onChange={(v) => editorStore.set({ mdView: v })} />}
        <EditorToolbar
          mode={mode}
          dirty={dirty}
          readOnly={readOnly}
          onMode={setMode}
          onSave={() => void saveRef.current()}
          onHide={() => editorStore.set({ visible: false })}
          onClose={requestClose}
        />
      </header>

      {tabs.length > 1 && (
        <EditorTabs
          tabs={tabs}
          active={openPath}
          root={root}
          onClose={(p) => void closeTab(p)}
          onCloseOthers={(p) => void closeOthers(p)}
          onCloseAll={() => void closeAllTabs()}
        />
      )}

      {banner && (
        <div className={`editor-banner ${banner.kind === "close" ? "" : "warn"}`}>
          {banner.kind === "conflict-save" && (
            <>
              <span>O arquivo foi alterado fora do editor desde que foi aberto.</span>
              <button className="btn btn-sm" onClick={() => void load(pathRef.current!, null, true)}>Recarregar do disco</button>
              <button className="btn btn-sm btn-danger" onClick={() => void saveRef.current(true)}>Sobrescrever</button>
            </>
          )}
          {banner.kind === "conflict-external" && (
            <>
              <span>Alteração externa detectada e há edições não salvas.</span>
              <button className="btn btn-sm" onClick={() => void load(pathRef.current!, null, true)}>Recarregar do disco</button>
              <button className="btn btn-sm" onClick={() => setBanner(null)}>Manter minhas edições</button>
            </>
          )}
          {banner.kind === "deleted" && (
            <>
              <span>O arquivo não existe mais no disco.</span>
              <button className="btn btn-sm" onClick={() => setBanner(null)}>Ok</button>
            </>
          )}
          {banner.kind === "close" && (
            <>
              <span>Fechar sem salvar as alterações?</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  await saveRef.current();
                  if (!editorStore.get().dirty) closeActiveNow();
                }}
              >
                Salvar e fechar
              </button>
              <button className="btn btn-sm btn-danger" onClick={closeActiveNow}>Descartar</button>
              <button className="btn btn-sm" onClick={() => setBanner(null)}>Cancelar</button>
            </>
          )}
        </div>
      )}

      <div className={`editor-main mdv-${isMd ? mdView : "code"}`}>
        <div className="editor-host" ref={hostRef} />
        {isMd && mdView !== "code" && openPath && <MarkdownPreview source={mdSource} path={openPath} />}
      </div>
      <footer className="editor-status">
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span>Ctrl+S salvar · Ctrl+F buscar{tabs.length > 1 ? " · Ctrl+Tab trocar aba" : ""}</span>
      </footer>
    </div>
  );
}

function EditorTabs(props: {
  tabs: EditorTab[];
  active: string | null;
  root: string | null;
  onClose: (p: string) => void;
  onCloseOthers: (p: string) => void;
  onCloseAll: () => void;
}) {
  const { tabs, active, root, onClose, onCloseOthers, onCloseAll } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".editor-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      className="editor-tabs"
      role="tablist"
      onWheel={(e) => {
        if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY;
      }}
    >
      {tabs.map((t) => {
        const on = sameKey(t.path, active);
        const rel = root ? toRel(root, t.path) ?? t.path : t.path;
        return (
          <div
            key={t.path}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={`editor-tab ${on ? "on" : ""} ${t.dirty ? "dirty" : ""}`}
            title={rel}
            onClick={() => openInEditor(t.path)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.path);
              }
            }}
            onContextMenu={(e) =>
              openContextMenu(e, [
                { label: "Fechar", hint: on ? "Ctrl+W" : undefined, run: () => onClose(t.path) },
                { label: "Fechar outras", disabled: tabs.length < 2, run: () => onCloseOthers(t.path) },
                { label: "Fechar todas", run: onCloseAll },
                "separator",
                { label: "Copiar caminho", run: () => void navigator.clipboard.writeText(t.path) },
                { label: "Copiar caminho relativo", run: () => void navigator.clipboard.writeText(rel) },
              ])
            }
          >
            <span className="editor-tab-name">{baseName(t.path)}</span>
            <button
              className="editor-tab-close"
              title={t.dirty ? "Alterações não salvas · fechar" : "Fechar"}
              aria-label={`Fechar ${baseName(t.path)}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.path);
              }}
            >
              <span className="dirty-dot" />
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MarkdownViewSwitch({ value, onChange }: { value: MarkdownView; onChange: (v: MarkdownView) => void }) {
  const opts: { v: MarkdownView; label: string; title: string }[] = [
    { v: "code", label: "Código", title: "Só o código" },
    { v: "split", label: "Lado a lado", title: "Código e prévia (Ctrl+K V)" },
    { v: "preview", label: "Prévia", title: "Só a prévia (Ctrl+Shift+V)" },
  ];
  return (
    <div className="md-switch" role="radiogroup" aria-label="Visualização do Markdown">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} className={value === o.v ? "on" : ""} title={o.title} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EditorToolbar(props: {
  mode: EditorMode;
  dirty: boolean;
  readOnly: boolean;
  onMode: (m: EditorMode) => void;
  onSave: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const { mode, dirty, readOnly, onMode, onSave, onHide, onClose } = props;
  return (
    <div className="editor-toolbar">
      <button className="icon-btn" title="Salvar (Ctrl+S)" disabled={!dirty || readOnly} onClick={onSave}>
        <Icon name="save" />
      </button>
      <span className="divider" />
      <button className={`icon-btn ${mode === "compact" ? "on" : ""}`} title="Compacto" onClick={() => onMode("compact")}>
        <Icon name="compact" />
      </button>
      <button className={`icon-btn ${mode === "expanded" ? "on" : ""}`} title="Expandido" onClick={() => onMode("expanded")}>
        <Icon name="restore" />
      </button>
      <button className={`icon-btn ${mode === "maximized" ? "on" : ""}`} title="Maximizado" onClick={() => onMode("maximized")}>
        <Icon name="maximize" />
      </button>
      <span className="divider" />
      <button className="icon-btn" title="Recolher (mantém o estado)" onClick={onHide}>
        <Icon name="minimize" />
      </button>
      <button className="icon-btn" title="Fechar arquivo (Ctrl+W)" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
