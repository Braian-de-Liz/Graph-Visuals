// Formatação de código: quais arquivos têm formatador e como aplicar o
// resultado no editor sem trocar o documento inteiro.

/** Go, Rust, TypeScript/JavaScript e PHP (as ferramentas ficam no backend). */
export const canFormat = (path: string | null) => !!path && /\.(go|rs|tsx?|mts|cts|jsx?|mjs|cjs|php)$/i.test(path);

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Menor trecho que diferencia `a` de `b` (prefixo e sufixo comuns ficam de
 * fora). Uma única mudança pequena mantém o cursor no lugar e faz o Ctrl+Z
 * desfazer a formatação inteira de uma vez.
 */
export function diffChange(a: string, b: string): { from: number; to: number; insert: string } {
  const max = Math.min(a.length, b.length);
  let s = 0;
  while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  if (s > 0 && isHigh(a.charCodeAt(s - 1))) s--; // não corta par substituto ao meio
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) {
    ea--;
    eb--;
  }
  if (ea < a.length && ea > s && isLow(a.charCodeAt(ea))) {
    ea++;
    eb++;
  }
  return { from: s, to: ea, insert: b.slice(s, eb) };
}
