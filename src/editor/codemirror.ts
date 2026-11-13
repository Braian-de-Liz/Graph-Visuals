// Configuração do CodeMirror 6: tema Graph Visuals e carregamento de linguagens
// sob demanda (cada pacote de linguagem vira um chunk separado).
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

export const gvTheme = EditorView.theme(
  {
    "&": { color: "#D7DCE4", backgroundColor: "transparent", height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', lineHeight: "1.55" },
    ".cm-content": { caretColor: "#EDEDEF", padding: "10px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#EDEDEF", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(255, 255, 255, 0.14) !important",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#3F3F46",
      border: "none",
      borderRight: "1px solid rgba(255, 255, 255, 0.06)",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#EDEDEF" },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
    ".cm-foldPlaceholder": { backgroundColor: "rgba(255,255,255,.08)", border: "none", color: "#A1A1AA" },
    ".cm-matchingBracket": { backgroundColor: "rgba(255, 255, 255, 0.1)", outline: "1px solid rgba(255,255,255,.25)" },
    ".cm-searchMatch": { backgroundColor: "rgba(213, 182, 106, 0.22)" },
    ".cm-searchMatch-selected": { backgroundColor: "rgba(57, 191, 255, 0.3)" },
    ".cm-panels": { backgroundColor: "#09090B", color: "#EDEDEF" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid rgba(255,255,255,.08)" },
    ".cm-panel input, .cm-panel button": { fontFamily: "inherit" },
    ".cm-tooltip": { backgroundColor: "#0F0F12", border: "1px solid rgba(255,255,255,.1)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(255,255,255,.08)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "#7FB2EC" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#CDB884" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#E3A27C" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#5D6673", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#39BFFF" },
  { tag: [t.typeName, t.className, t.namespace], color: "#9AD7EA" },
  { tag: [t.definition(t.variableName)], color: "#E6EAF0" },
  { tag: [t.propertyName, t.attributeName], color: "#C3CBD6" },
  { tag: [t.tagName], color: "#39BFFF" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#8A919B" },
  { tag: [t.heading], color: "#D5B66A", fontWeight: "600" },
  { tag: [t.link, t.url], color: "#39BFFF", textDecoration: "underline" },
  { tag: [t.meta, t.annotation], color: "#B6A16E" },
  { tag: t.invalid, color: "#E0566A" },
]);

export const gvHighlight: Extension = syntaxHighlighting(highlight);

export async function languageFor(path: string): Promise<LanguageSupport | null> {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "py":
    case "pyw":
      return (await import("@codemirror/lang-python")).python();
    case "json":
    case "jsonc":
      return (await import("@codemirror/lang-json")).json();
    case "css":
    case "scss":
    case "less":
      return (await import("@codemirror/lang-css")).css();
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return (await import("@codemirror/lang-html")).html();
    case "md":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    default:
      return null;
  }
}
