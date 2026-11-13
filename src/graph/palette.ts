// Paleta oficial do grafo — Graph Visuals, com a distribuição visual desejada.
//
// Vision Gold  #D5B66A  30%  primária: identidade, nós principais e destaques
// Vision Red   #A83242  20%  secundária: comunidades, nós especiais, atividade secundária
// Stark Blue   #193C64  20%  estrutura, nós comuns e profundidade
// Obsidian     #080B12  18%  fundo e espaço visual
// Titanium     #858B94   8%  conexões e elementos neutros
// Arc Light    #39BFFF   4%  seleção e foco interativo
//
// Fundo, conexões e seleção já ocupam suas parcelas por natureza. Entre os
// nós, as comunidades são distribuídas pelas três famílias na proporção
// 30 : 20 : 20 (≈ 43% / 29% / 28% dos nós), contando o tamanho de cada uma.
import * as THREE from "three";

export const PALETTE = {
  obsidian: "#080B12",
  starkBlue: "#193C64",
  visionGold: "#D5B66A",
  visionRed: "#A83242",
  titanium: "#858B94",
  arcLight: "#39BFFF",
} as const;

export type Family = "gold" | "red" | "blue";

const SHARE: Record<Family, number> = { gold: 30, red: 20, blue: 20 };

/** Variações de cada família (matiz em graus, saturação, luminosidade). */
const VARIANTS: Record<Family, [number, number, number][]> = {
  // em torno de #D5B66A (42°, 56%, 63%)
  gold: [
    [42, 0.62, 0.64],
    [39, 0.66, 0.58],
    [46, 0.58, 0.7],
    [36, 0.62, 0.55],
    [48, 0.55, 0.66],
  ],
  // em torno de #A83242 (352°, 54%, 43%), clareado para leitura sobre o Obsidian
  red: [
    [352, 0.54, 0.47],
    [348, 0.58, 0.54],
    [356, 0.5, 0.42],
    [345, 0.5, 0.58],
    [0, 0.48, 0.5],
  ],
  // em torno de #193C64 (212°, 60%, 25%), clareado para leitura
  blue: [
    [212, 0.6, 0.42],
    [208, 0.55, 0.5],
    [216, 0.62, 0.36],
    [204, 0.5, 0.56],
    [220, 0.55, 0.46],
  ],
};

export interface CommunityStyle {
  family: Family;
  variant: number;
}

/**
 * Distribui comunidades entre as famílias para que a contagem de nós de cada
 * uma se aproxime da proporção alvo. As maiores comunidades são atribuídas
 * primeiro e o dourado (primária) desempata, ficando com as principais.
 * Determinístico para o mesmo grafo.
 */
export function assignCommunities(sizes: Map<number, number>): Map<number, CommunityStyle> {
  const total = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
  const shareSum = SHARE.gold + SHARE.red + SHARE.blue;
  const used: Record<Family, number> = { gold: 0, red: 0, blue: 0 };
  const count: Record<Family, number> = { gold: 0, red: 0, blue: 0 };
  const out = new Map<number, CommunityStyle>();
  const ordered = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  for (const [c, size] of ordered) {
    let best: Family = "gold";
    let bestDeficit = -Infinity;
    for (const f of ["gold", "red", "blue"] as Family[]) {
      const deficit = (SHARE[f] / shareSum) * total - used[f];
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = f;
      }
    }
    used[best] += size;
    out.set(c, { family: best, variant: count[best]++ % VARIANTS[best].length });
  }
  return out;
}

export function familyColor(style: CommunityStyle, out = new THREE.Color()): THREE.Color {
  const [h, s, l] = VARIANTS[style.family][style.variant];
  return out.setHSL(h / 360, s, l);
}

// Cor da comunidade fora da cena (inspetor), a partir da última atribuição.
let lastAssignment = new Map<number, CommunityStyle>();
export const setLastAssignment = (m: Map<number, CommunityStyle>) => (lastAssignment = m);

export function communityColor(c: number | null, out = new THREE.Color()): THREE.Color {
  const style = c === null ? undefined : lastAssignment.get(c);
  return style ? familyColor(style, out) : out.set(PALETTE.titanium);
}

export function communityCss(c: number | null): string {
  return "#" + communityColor(c).getHexString();
}
