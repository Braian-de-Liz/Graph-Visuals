// Ctrl+clique (ou F12) no caminho de uma importação abre o arquivo importado,
// como no VS Code. Com Ctrl pressionado, o caminho sob o mouse fica sublinhado.
// A resolução usa o índice de arquivos do projeto (sem node_modules).
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { fsStatMtime } from "../lib/ipc";
import { dirName, joinRel, toRel } from "../lib/paths";
import { projectStore } from "../state/project";
import { openInEditor } from "../state/editor";
import { toast } from "../state/ui";

interface ImportRef {
  from: number;
  to: number;
  /** Caminhos relativos ao projeto a testar, em ordem de preferência. */
  candidates: (fileRel: string) => string[];
  label: string;
}

const JS_EXTS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json", ".vue", ".svelte", ".css", ".scss"];
const IMPORT_LINE = /\b(import|from|require|export|include|@import|@use|@forward|url|src|href|load|source)\b/;

/** Junta e normaliza `a/b` + `../c` → `a/c`; null se sair da raiz. */
function joinNorm(base: string, spec: string): string | null {
  const out = base ? base.split("/") : [];
  for (const part of spec.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

function jsCandidates(target: string): string[] {
  const list = [target];
  const m = /\.(m|c)?jsx?$/.exec(target);
  if (m) {
    // ESM em TypeScript: `./a.js` aponta para `a.ts`.
    const stem = target.slice(0, -m[0].length);
    list.push(stem + ".ts", stem + ".tsx", stem + ".mts", stem + ".cts");
  }
  for (const e of JS_EXTS) list.push(target + e);
  for (const e of JS_EXTS) list.push(target + "/index" + e);
  return list;
}

/** Caminho em string (relativo, absoluto do projeto ou alias comum). */
function pathSpecCandidates(raw: string, fileRel: string): string[] {
  const spec = raw.replace(/[?#].*$/, "");
  if (!spec || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return []; // URLs, node:, data:
  const dir = dirName(fileRel);
  const bases: (string | null)[] = [];
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") bases.push(joinNorm(dir, spec));
  else if (spec.startsWith("/")) bases.push(joinNorm("", spec));
  else if (/^[@~]\//.test(spec)) bases.push(joinNorm("src", spec.slice(2)), joinNorm("", spec.slice(2)));
  else {
    // Especificador "nu": arquivo vizinho (CSS, HTML), baseUrl na raiz ou em src.
    bases.push(joinNorm(dir, spec), joinNorm("", spec), joinNorm("src", spec));
  }
  return bases.filter((b): b is string => b !== null && b !== "").flatMap(jsCandidates);
}

function pythonCandidates(module: string, fileRel: string): string[] {
  const dots = /^\.*/.exec(module)![0].length;
  const rest = module.slice(dots).replace(/\./g, "/");
  const bases: (string | null)[] = [];
  if (dots) {
    let base = dirName(fileRel);
    for (let i = 1; i < dots; i++) base = dirName(base);
    bases.push(rest ? joinNorm(base, rest) : base);
  } else {
    bases.push(joinNorm(dirName(fileRel), rest), rest, joinNorm("src", rest));
  }
  return bases
    .filter((b): b is string => b !== null)
    .flatMap((b) => (b ? [b + ".py", b + ".pyi", b + "/__init__.py"] : ["__init__.py"]));
}

/** Encontra a referência de importação na posição `pos`, se houver. */
export function importAt(view: EditorView, pos: number): ImportRef | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const col = pos - line.from;

  // Python: `from a.b import c` / `import a.b as c, d`.
  const py = /^(\s*)(from\s+(\.*[\w.]*)\s+import\s+(.+)|import\s+(.+))$/.exec(text);
  if (py && !/["'`]/.test(text)) {
    const words = [...text.matchAll(/\.*[A-Za-z_][\w.]*|\.+/g)];
    const hit = words.find((w) => col >= w.index! && col <= w.index! + w[0].length);
    if (!hit || ["from", "import", "as"].includes(hit[0])) return null;
    const fromMod = py[3];
    const span = { from: line.from + hit.index!, to: line.from + hit.index! + hit[0].length };
    if (fromMod !== undefined && hit[0] !== fromMod) {
      // Nome importado: pode ser um submódulo (`from pkg import mod`).
      const sep = fromMod.endsWith(".") || fromMod === "" ? "" : ".";
      return {
        ...span,
        label: hit[0],
        candidates: (f) => [...pythonCandidates(fromMod + sep + hit[0], f), ...pythonCandidates(fromMod, f)],
      };
    }
    return { ...span, label: hit[0], candidates: (f) => pythonCandidates(hit[0], f) };
  }

  // Rust: `mod foo;`
  const rs = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/.exec(text);
  if (rs) {
    const start = text.indexOf(rs[1], text.indexOf("mod") + 3);
    if (col < start || col > start + rs[1].length) return null;
    return {
      from: line.from + start,
      to: line.from + start + rs[1].length,
      label: rs[1],
      candidates: (f) => {
        const dir = dirName(f);
        const stem = f.slice(dir ? dir.length + 1 : 0).replace(/\.rs$/, "");
        const own = ["mod", "lib", "main"].includes(stem) ? dir : joinNorm(dir, stem) ?? dir;
        const p = (s: string) => (own ? `${own}/${s}` : s);
        return [p(`${rs[1]}.rs`), p(`${rs[1]}/mod.rs`)];
      },
    };
  }

  // Strings em linhas de importação (JS/TS, CSS, HTML, etc.).
  if (!IMPORT_LINE.test(text)) return null;
  for (const m of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1|url\(\s*([^)"'\s]+)\s*\)/g)) {
    const value = m[2] ?? m[3];
    const start = m.index! + (m[2] !== undefined ? 1 : m[0].indexOf(value));
    if (col < start || col > start + value.length || !value) continue;
    return {
      from: line.from + start,
      to: line.from + start + value.length,
      label: value,
      candidates: (f) => pathSpecCandidates(value, f),
    };
  }
  return null;
}

let indexCache: { source: unknown; files: Map<string, string> } | null = null;
function fileMap(): Map<string, string> {
  const { index } = projectStore.get();
  if (indexCache?.source !== index) {
    const files = new Map<string, string>();
    for (const e of index) if (!e.isDir) files.set(e.rel.toLowerCase(), e.rel);
    indexCache = { source: index, files };
  }
  return indexCache.files;
}

async function follow(ref: ImportRef, currentPath: string | null) {
  const { root, indexTruncated } = projectStore.get();
  if (!root || !currentPath) return;
  const fileRel = toRel(root, currentPath);
  if (fileRel === null) return;
  const candidates = ref.candidates(fileRel);
  const files = fileMap();
  let found = candidates.map((c) => files.get(c.toLowerCase())).find((x) => x !== undefined) ?? null;
  if (!found && indexTruncated) {
    for (const c of candidates) {
      try {
        await fsStatMtime(joinRel(root, c));
        found = c;
        break;
      } catch {
        /* não existe */
      }
    }
  }
  if (found) openInEditor(joinRel(root, found));
  else toast(`Não encontrei "${ref.label}" no projeto (pacote externo?)`);
}

const linkMark = Decoration.mark({ class: "cm-import-link" });

/** Extensão: Ctrl+clique / F12 seguem a importação; sublinhado com Ctrl. */
export function importLinks(currentPath: () => string | null): Extension {
  const hover = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      x = 0;
      y = 0;
      ctrl = false;
      constructor(readonly view: EditorView) {}
      refresh() {
        const pos = this.ctrl ? this.view.posAtCoords({ x: this.x, y: this.y }) : null;
        const ref = pos === null ? null : importAt(this.view, pos);
        const next = ref ? Decoration.set([linkMark.range(ref.from, ref.to)]) : Decoration.none;
        if (next.size || this.decorations.size) {
          this.decorations = next;
          this.view.dispatch({}); // redesenha as decorações
        }
      }
      update(_u: ViewUpdate) {}
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousemove(e) {
          this.x = e.clientX;
          this.y = e.clientY;
          this.ctrl = e.ctrlKey || e.metaKey;
          this.refresh();
        },
        mouseleave() {
          this.ctrl = false;
          this.refresh();
        },
        keydown(e) {
          if (e.key === "Control" || e.key === "Meta") {
            this.ctrl = true;
            this.refresh();
          }
        },
        keyup(e) {
          if (e.key === "Control" || e.key === "Meta") {
            this.ctrl = false;
            this.refresh();
          }
        },
      },
    },
  );

  return [
    hover,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const ref = pos === null ? null : importAt(view, pos);
        if (!ref) return false;
        e.preventDefault();
        void follow(ref, currentPath());
        return true;
      },
    }),
    keymap.of([
      {
        key: "F12",
        preventDefault: true,
        run: (view) => {
          const ref = importAt(view, view.state.selection.main.head);
          if (!ref) return false;
          void follow(ref, currentPath());
          return true;
        },
      },
    ]),
    EditorView.theme({
      ".cm-import-link, .cm-import-link *": {
        textDecoration: "underline",
        textUnderlineOffset: "3px",
        cursor: "pointer",
        color: "#39BFFF !important",
      },
    }),
  ];
}
