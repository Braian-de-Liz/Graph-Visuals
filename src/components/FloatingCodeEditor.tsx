// Editor flutuante (CodeMirror 6). Aparece sob demanda; o grafo continua
// sendo o ambiente principal. Estados: compacto, expandido e maximizado.
import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { Icon } from "./Icons";
import { gvHighlight, gvTheme, languageFor } from "../editor/codemirror";
import { importLinks } from "../editor/importLinks";
import { fsReadText, fsStatMtime, fsWriteText, onFsChanged } from "../lib/ipc";
import { baseName, pathKey, toRel } from "../lib/paths";
import { editorStore, isMarkdown, registerEditorHandlers, type EditorMode, type MarkdownView } from "../state/editor";
import { MarkdownPreview } from "./MarkdownPreview";
import { projectStore } from "../state/project";
import { toast } from "../state/ui";
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

type Banner =
  | { kind: "conflict-save" }
  | { kind: "conflict-external" }
  | { kind: "deleted" }
  | { kind: "switch"; path: string; line: number | null }
  | { kind: "close" };

export function FloatingCodeEditor() {
  const visible = editorStore.use((s) => s.visible);
  const mode = editorStore.use((s) => s.mode);
  const openPath = editorStore.use((s) => s.openPath);
  const dirty = editorStore.use((s) => s.dirty);
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
  const scheduleRef = useRef<() => void>(() => {});
  const bannerRef = useRef<Banner | null>(null);

  const [banner, setBanner] = useState<Banner | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

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
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          setCursor({ line: line.number, col: head - line.from + 1 });
        }
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

  async function load(path: string, line: number | null, keepView = false) {
    const view = viewRef.current;
    if (!view) return;
    setLoading(true);
    try {
      const file = await fsReadText(path);
      const lang = await languageFor(path);
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
      setReadOnly(file.lossy);
      setBanner(null);
      editorStore.set({ openPath: path, dirty: false });
      setMdSource(isMarkdown(path) ? file.content : "");
      if (keepView) {
        const pos = Math.min(prevSel, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos } });
        view.scrollDOM.scrollTop = prevScroll;
      } else {
        goToLine(line);
      }
    } catch (e) {
      loadingRef.current = false;
      toast(`Não foi possível abrir ${baseName(path)}: ${e}`, "error");
      if (!pathRef.current) editorStore.set({ visible: false });
    } finally {
      setLoading(false);
    }
  }

  function goToLine(line: number | null) {
    const view = viewRef.current;
    if (!view) return;
    const n = Math.max(1, Math.min(line ?? 1, view.state.doc.lines));
    const l = view.state.doc.line(n);
    view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: line ? "center" : "start" }) });
    requestAnimationFrame(() => view.focus());
  }

  /**
   * Grava o arquivo. `auto`: salvamento automático, sem aviso, e ignorado
   * enquanto houver um conflito pendente. Retorna true se gravou.
   */
  async function save(force = false, auto = false): Promise<boolean> {
    const view = viewRef.current;
    const path = pathRef.current;
    if (!view || !path || readOnly) return false;
    if (auto && (bannerRef.current || savingRef.current || !editorStore.get().dirty)) return false;
    const seq = changeSeqRef.current;
    savingRef.current = true;
    try {
      const r = root ? toRel(root, path) : null;
      if (r) markSelfWrite(r);
      const mtime = await fsWriteText(path, view.state.doc.toString(), force ? null : mtimeRef.current);
      if (pathRef.current !== path) return true; // trocou de arquivo durante a gravação
      mtimeRef.current = mtime;
      // Digitou durante a gravação: continua "sujo" e agenda outra.
      if (changeSeqRef.current === seq) editorStore.set({ dirty: false });
      else scheduleAutoSave();
      setBanner(null);
      if (!auto) toast(`${baseName(path)} salvo`);
      return true;
    } catch (e) {
      if (String(e) === "conflict") setBanner({ kind: "conflict-save" });
      else toast(`Falha ao salvar: ${e}`, "error");
      return false;
    } finally {
      savingRef.current = false;
    }
  }
  saveRef.current = save;

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
    if (pathRef.current && pathKey(requestedPath) === pathKey(pathRef.current)) {
      goToLine(requestedLine);
      return;
    }
    if (editorStore.get().dirty) {
      // Com salvamento automático, grava e troca; se a gravação falhar (ex.: conflito), pergunta.
      if (settingsStore.get().autoSave && !bannerRef.current) {
        clearTimeout(autoTimerRef.current);
        void saveRef.current(false, true).then((ok) =>
          ok ? load(requestedPath, requestedLine) : setBanner({ kind: "switch", path: requestedPath, line: requestedLine }),
        );
      } else setBanner({ kind: "switch", path: requestedPath, line: requestedLine });
    } else void load(requestedPath, requestedLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // --- alterações externas ---
  useEffect(() => {
    const un = onFsChanged(async (e) => {
      const path = pathRef.current;
      if (!path) return;
      const key = pathKey(path);
      if (!e.rescan && !e.paths.some((p) => pathKey(p) === key)) return;
      try {
        const mtime = await fsStatMtime(path);
        if (mtime === mtimeRef.current) return; // gravação nossa ou sem mudança
        if (editorStore.get().dirty) setBanner({ kind: "conflict-external" });
        else void load(path, null, true);
      } catch {
        setBanner({ kind: "deleted" });
      }
    });
    return () => {
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Projeto trocado: fecha o arquivo do projeto anterior.
  useEffect(() => {
    if (pathRef.current && (!root || toRel(root, pathRef.current) === null)) closeNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  function closeNow() {
    clearTimeout(autoTimerRef.current);
    pathRef.current = null;
    mtimeRef.current = null;
    setBanner(null);
    loadingRef.current = true;
    viewRef.current?.setState(EditorState.create({ doc: "", extensions: baseExtensions() }));
    loadingRef.current = false;
    editorStore.set({ openPath: null, dirty: false, visible: false, mode: "compact" });
  }

  const requestClose = () => {
    if (!editorStore.get().dirty) return closeNow();
    if (settingsStore.get().autoSave && !bannerRef.current) {
      clearTimeout(autoTimerRef.current);
      void saveRef.current(false, true).then((ok) => (ok ? closeNow() : setBanner({ kind: "close" })));
    } else setBanner({ kind: "close" });
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    registerEditorHandlers({
      save: () => {
        if (pathRef.current && editorStore.get().visible) void saveRef.current();
      },
      close: () => {
        if (pathRef.current) requestCloseRef.current();
      },
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
          onSave={() => void save()}
          onHide={() => editorStore.set({ visible: false })}
          onClose={requestClose}
        />
      </header>

      {banner && (
        <div className={`editor-banner ${banner.kind === "switch" || banner.kind === "close" ? "" : "warn"}`}>
          {banner.kind === "conflict-save" && (
            <>
              <span>O arquivo foi alterado fora do editor desde que foi aberto.</span>
              <button className="btn btn-sm" onClick={() => void load(pathRef.current!, null, true)}>Recarregar do disco</button>
              <button className="btn btn-sm btn-danger" onClick={() => void save(true)}>Sobrescrever</button>
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
          {banner.kind === "switch" && (
            <>
              <span>Há alterações não salvas em {baseName(pathRef.current ?? "")}.</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  await save();
                  if (!editorStore.get().dirty) void load(banner.path, banner.line);
                }}
              >
                Salvar e abrir
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => void load(banner.path, banner.line)}>Descartar</button>
              <button className="btn btn-sm" onClick={() => setBanner(null)}>Cancelar</button>
            </>
          )}
          {banner.kind === "close" && (
            <>
              <span>Fechar sem salvar as alterações?</span>
              <button className="btn btn-sm btn-primary" onClick={async () => { await save(); if (!editorStore.get().dirty) closeNow(); }}>Salvar e fechar</button>
              <button className="btn btn-sm btn-danger" onClick={closeNow}>Descartar</button>
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
        <span>Ctrl+S salvar · Ctrl+F buscar</span>
      </footer>
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
      <button className="icon-btn" title="Fechar" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
