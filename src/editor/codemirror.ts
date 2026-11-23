// Configuração do CodeMirror 6: tema Graph Visuals e carregamento de linguagens
// sob demanda (cada pacote de linguagem vira um chunk separado).
import { EditorView } from "@codemirror/view";
import { HighlightStyle, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
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

// Paleta de sintaxe (sobre o fundo #050506).
const c = {
  decl: "#7FB2EC", // declarações: const, fn, class, import
  flow: "#B49CE8", // fluxo de controle: if, return, for
  string: "#CDB884",
  escape: "#E3A27C", // escapes e números
  constant: "#F0A0A0", // constantes e this
  fn: "#39BFFF", // chamada de função
  fnDef: "#6FD0FF", // definição de função
  type: "#7DD3B0", // tipos, classes, namespaces
  prop: "#9CC2E8", // propriedades e chaves de JSON
  tag: "#E58F9E", // tags HTML
  meta: "#D5B66A", // decoradores, macros, títulos
  variable: "#D7DCE4",
  special: "#8FD0E8", // $variáveis do PowerShell
  punct: "#8A919B",
  comment: "#5D6673",
};

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.moduleKeyword], color: c.decl },
  { tag: [t.controlKeyword, t.operatorKeyword], color: c.flow },
  { tag: [t.string, t.regexp], color: c.string },
  { tag: [t.escape, t.special(t.string)], color: c.escape },
  { tag: [t.number, t.bool, t.null, t.atom], color: c.escape },
  { tag: [t.constant(t.variableName), t.self], color: c.constant },
  { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.standard(t.variableName), t.standard(t.name)], color: c.fn },
  { tag: [t.definition(t.function(t.variableName)), t.definition(t.function(t.propertyName))], color: c.fnDef },
  { tag: [t.typeName, t.className, t.namespace], color: c.type },
  { tag: [t.variableName, t.definition(t.variableName)], color: c.variable },
  { tag: t.special(t.variableName), color: c.special },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: c.prop },
  { tag: [t.tagName], color: c.tag },
  { tag: [t.operator, t.punctuation, t.bracket], color: c.punct },
  { tag: [t.heading], color: c.meta, fontWeight: "600" },
  { tag: [t.link, t.url], color: c.fn, textDecoration: "underline" },
  { tag: [t.meta, t.annotation], color: c.meta },
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
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "php":
    case "phtml":
    case "php5":
    case "inc":
      // PHP puro ou misturado com HTML; cores e autocomplete (palavras-chave, funções) vêm do pacote.
      return (await import("@codemirror/lang-php")).php();
    case "ps1":
    case "psm1":
    case "psd1": {
      // PowerShell só existe como modo legado; as tags mapeadas usam a mesma paleta.
      const [{ StreamLanguage }, { powerShell }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/powershell"),
      ]);
      return new LanguageSupport(StreamLanguage.define(powerShell));
    }
    case "md":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    default:
      return null;
  }
}
