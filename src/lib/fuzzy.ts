// Pontuação aproximada para a pesquisa (Ctrl + P).
// Suporta prefixo, caminho parcial e subsequência ("gscn" -> GraphScene.ts).

export interface Match {
  score: number;
  /** Índices dos caracteres casados em `text`. */
  positions: number[];
}

const SEPARATORS = new Set(["/", "\\", "_", "-", ".", " "]);

/** Retorna null se `query` não for subsequência de `text`. */
export function fuzzyMatch(query: string, text: string): Match | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, positions: [] };

  // Substring direta pontua mais que subsequência espalhada.
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const positions = Array.from({ length: q.length }, (_, k) => direct + k);
    const atBoundary = direct === 0 || SEPARATORS.has(t[direct - 1]);
    return { score: 1000 + (atBoundary ? 300 : 0) - direct - t.length * 0.5, positions };
  }

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found < 0) return null;
    positions.push(found);
    if (found === prev + 1) score += 15;
    if (found === 0 || SEPARATORS.has(t[found - 1])) score += 20;
    else if (text[found] !== t[found]) score += 10; // início de palavra camelCase
    prev = found;
    ti = found + 1;
  }
  score -= (positions[positions.length - 1] - positions[0]) * 0.5;
  score -= t.length * 0.2;
  return { score, positions };
}

/**
 * Casa o termo primeiro contra o nome do arquivo e depois contra o caminho
 * completo; correspondências no nome valem mais.
 */
export function matchPath(query: string, rel: string): Match | null {
  const slash = rel.lastIndexOf("/");
  const name = rel.slice(slash + 1);
  const onName = query.includes("/") ? null : fuzzyMatch(query, name);
  if (onName) {
    return { score: onName.score + 500, positions: onName.positions.map((p) => p + slash + 1) };
  }
  return fuzzyMatch(query, rel);
}
