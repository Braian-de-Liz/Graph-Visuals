// Utilitários de caminho. O backend devolve caminhos absolutos do SO; o
// Graphify e o índice usam caminhos relativos com `/`.

export function sepOf(root: string): string {
  return root.includes("\\") ? "\\" : "/";
}

/** Junta a raiz do projeto com um caminho relativo (`a/b.ts`). */
export function joinRel(root: string, rel: string): string {
  const sep = sepOf(root);
  const clean = rel.replace(/^[/\\]+/, "").replace(/[/\\]/g, sep);
  return root.endsWith(sep) ? root + clean : root + sep + clean;
}

/** Caminho relativo com `/`, ou null se `abs` não estiver dentro de `root`. */
export function toRel(root: string, abs: string): string | null {
  const a = abs.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  if (a.toLowerCase() === r.toLowerCase()) return "";
  if (!a.toLowerCase().startsWith(r.toLowerCase() + "/")) return null;
  return a.slice(r.length + 1);
}

/** Chave de comparação (Windows não diferencia maiúsculas). */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function baseName(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function dirName(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}
