// Layout 3D executado fora da thread principal.
//
// Forma: "arquipélago" orgânico, espalhado e não esférico.
// - Os centros das comunidades são posicionados por um layout de forças no
//   nível das comunidades: comunidades conectadas se atraem (proporcional ao
//   número de arestas entre elas) e todas se repelem. O espalhamento resultante
//   reflete a estrutura real do Graphify, sem formas geométricas impostas.
// - O volume é anisotrópico: amplo no plano horizontal (visto de cima) e
//   achatado no eixo vertical, então não vira uma esfera.
//
// Estabilidade espacial entre atualizações:
// - Nós que já existiam usam a posição anterior como âncora (mola forte).
// - Nós novos nascem perto da média dos vizinhos já posicionados; sem
//   vizinhos, usam uma âncora determinística derivada de (comunidade, id).
// A posição é só visual; não altera a estrutura produzida pelo Graphify.

export interface LayoutRequest {
  ids: string[];
  communities: (number | null)[];
  /** Pares [s0, t0, s1, t1, ...] de índices. */
  edges: Uint32Array;
  /** Posições anteriores por nó (x, y, z) e máscara de quais existem. */
  prev?: Float32Array;
  hasPrev?: Uint8Array;
}

export interface LayoutResponse {
  positions: Float32Array;
  /** Estrelas decorativas espalhadas em torno das comunidades. */
  stars: Float32Array;
}

function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const unit = (h: number) => h / 4294967296;

/**
 * Escala por eixo do espaço das comunidades. Proporções diferentes nos três
 * eixos: nem esfera (todos iguais) nem disco (vertical quase nulo).
 */
const AXIS = [1.3, 0.72, 1.0] as const;

/** Raio de uma comunidade; o termo constante dá folga extra aos grupos pequenos. */
const clusterRadiusOf = (size: number) => 2.6 * Math.cbrt(size) + 6;

/** Distância mínima entre nós da mesma comunidade pequena. */
const SMALL_GROUP = 60;
const NODE_GAP = 6.5;

/**
 * Layout de forças entre comunidades (Fruchterman–Reingold simplificado).
 * O(m² · iterações); m é o número de comunidades (dezenas a poucas centenas).
 */
function placeCommunities(
  ordered: number[],
  sizes: Map<number, number>,
  links: Map<string, number>,
  R: number,
): Map<number, [number, number, number]> {
  const m = ordered.length;
  const idx = new Map(ordered.map((c, i) => [c, i]));
  const p = new Float64Array(m * 3);
  const radius = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const c = ordered[i];
    // Posição inicial determinística num volume já achatado.
    for (let d = 0; d < 3; d++) p[i * 3 + d] = (unit(fnv1a(String(c), 31 + d)) - 0.5) * R * AXIS[d] * 1.6;
    radius[i] = clusterRadiusOf(sizes.get(c)!);
  }
  const pairs: [number, number, number][] = [];
  for (const [key, w] of links) {
    const [a, b] = key.split("|").map(Number);
    const ia = idx.get(a);
    const ib = idx.get(b);
    if (ia !== undefined && ib !== undefined) pairs.push([ia, ib, w]);
  }

  const k = (R / Math.max(Math.sqrt(m), 1)) * 1.45; // distância ideal (maior = grupos mais separados)
  const disp = new Float64Array(m * 3);
  const iterations = m > 300 ? 120 : 260;
  let temp = R * 0.25;
  for (let it = 0; it < iterations; it++) {
    disp.fill(0);
    // Repulsão entre todas as comunidades (mais forte entre as grandes).
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        let dx = p[i * 3] - p[j * 3];
        let dy = (p[i * 3 + 1] - p[j * 3 + 1]) / AXIS[1];
        let dz = p[i * 3 + 2] - p[j * 3 + 2];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-6) {
          dx = 0.1;
          dz = 0.1;
          d2 = 0.02;
        }
        const d = Math.sqrt(d2);
        const min = Math.max((radius[i] + radius[j]) * 1.7, k * 0.95);
        const f = (k * k) / d + (d < min ? (min - d) * 4 : 0);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        const fz = (dz / d) * f;
        disp[i * 3] += fx;
        disp[i * 3 + 1] += fy;
        disp[i * 3 + 2] += fz;
        disp[j * 3] -= fx;
        disp[j * 3 + 1] -= fy;
        disp[j * 3 + 2] -= fz;
      }
    }
    // Atração entre comunidades conectadas.
    for (const [a, b, w] of pairs) {
      const dx = p[b * 3] - p[a * 3];
      const dy = (p[b * 3 + 1] - p[a * 3 + 1]) / AXIS[1];
      const dz = p[b * 3 + 2] - p[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = ((d * d) / k) * Math.min(Math.log2(1 + w) * 0.25, 1.1);
      disp[a * 3] += (dx / d) * f;
      disp[a * 3 + 1] += (dy / d) * f;
      disp[a * 3 + 2] += (dz / d) * f;
      disp[b * 3] -= (dx / d) * f;
      disp[b * 3 + 1] -= (dy / d) * f;
      disp[b * 3 + 2] -= (dz / d) * f;
    }
    // Gravidade anisotrópica e fraca no vertical: impede que comunidades
    // isoladas fujam, sem achatar o volume.
    for (let i = 0; i < m; i++) {
      disp[i * 3] -= p[i * 3] * 0.035 * k;
      disp[i * 3 + 1] -= (p[i * 3 + 1] / AXIS[1]) * 0.035 * k;
      disp[i * 3 + 2] -= p[i * 3 + 2] * 0.035 * k;
    }
    for (let i = 0; i < m; i++) {
      const dx = disp[i * 3];
      const dy = disp[i * 3 + 1];
      const dz = disp[i * 3 + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const step = Math.min(len, temp);
      p[i * 3] += (dx / len) * step * AXIS[0];
      p[i * 3 + 1] += (dy / len) * step * AXIS[1];
      p[i * 3 + 2] += (dz / len) * step * AXIS[2];
    }
    temp *= 0.985;
  }

  // Normaliza pela extensão (percentil 80) e traz outliers de volta com um
  // limite suave POR EIXO — um limite radial criaria um contorno circular.
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < m; i++) {
    mx += p[i * 3];
    my += p[i * 3 + 1];
    mz += p[i * 3 + 2];
  }
  mx /= m || 1;
  my /= m || 1;
  mz /= m || 1;
  const pct = (d: number) => {
    const v = Array.from({ length: m }, (_, i) => Math.abs(p[i * 3 + d] - [mx, my, mz][d])).sort((a, b) => a - b);
    return Math.max(v[Math.floor((m - 1) * 0.8)] ?? 1, 1e-3);
  };
  const ext = [pct(0), pct(1), pct(2)];
  const s = (R * 0.8) / Math.max(ext[0], ext[2]);
  const soft = (v: number, lim: number) => {
    const a = Math.abs(v);
    if (a <= lim) return v;
    return Math.sign(v) * (lim + Math.log1p((a - lim) / lim) * lim * 0.35);
  };
  const out = new Map<number, [number, number, number]>();
  for (let i = 0; i < m; i++) {
    const x = soft(p[i * 3] - mx, ext[0] * 1.35);
    const y = soft(p[i * 3 + 1] - my, ext[1] * 1.35);
    const z = soft(p[i * 3 + 2] - mz, ext[2] * 1.35);
    out.set(ordered[i], [x * s, y * s, z * s]);
  }
  return out;
}

function layout({ ids, communities, edges, prev, hasPrev }: LayoutRequest): { positions: Float32Array; stars: Float32Array } {
  const n = ids.length;
  const pos = new Float32Array(n * 3);
  const anchor = new Float32Array(n * 3);
  const anchorK = new Float32Array(n);

  const sizes = new Map<number, number>();
  for (const c of communities) sizes.set(c ?? -1, (sizes.get(c ?? -1) ?? 0) + 1);
  const ordered = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)! || a - b);
  const links = new Map<string, number>();
  for (let e = 0; e < edges.length; e += 2) {
    const a = communities[edges[e]] ?? -1;
    const b = communities[edges[e + 1]] ?? -1;
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    links.set(key, (links.get(key) ?? 0) + 1);
  }
  const R = 24 * Math.cbrt(n) + 40;
  const centerOf = placeCommunities(ordered, sizes, links, R);

  const deterministic = (i: number, out: Float32Array) => {
    const c = communities[i] ?? -1;
    const [cx, cy, cz] = centerOf.get(c)!;
    const clusterRadius = clusterRadiusOf(sizes.get(c)!);
    const u = unit(fnv1a(ids[i], 1));
    const v = unit(fnv1a(ids[i], 2));
    const w = unit(fnv1a(ids[i], 3));
    const phi = 2 * Math.PI * u;
    const cosT = 2 * v - 1;
    const sinT = Math.sqrt(1 - cosT * cosT);
    const rad = clusterRadius * Math.cbrt(w);
    out[i * 3] = cx + rad * sinT * Math.cos(phi);
    out[i * 3 + 1] = cy + rad * cosT * 0.85;
    out[i * 3 + 2] = cz + rad * sinT * Math.sin(phi);
  };

  const keep = !!prev && !!hasPrev && hasPrev.some((x) => x === 1);
  if (keep) {
    const neighbors: number[][] = Array.from({ length: n }, () => []);
    for (let e = 0; e < edges.length; e += 2) {
      neighbors[edges[e]].push(edges[e + 1]);
      neighbors[edges[e + 1]].push(edges[e]);
    }
    for (let i = 0; i < n; i++) {
      if (hasPrev![i]) {
        anchor.set(prev!.subarray(i * 3, i * 3 + 3), i * 3);
        anchorK[i] = 0.6;
        continue;
      }
      const known = neighbors[i].filter((j) => hasPrev![j]);
      if (known.length) {
        for (let d = 0; d < 3; d++) {
          let s = 0;
          for (const j of known) s += prev![j * 3 + d];
          anchor[i * 3 + d] = s / known.length + (unit(fnv1a(ids[i], 7 + d)) - 0.5) * 6;
        }
      } else {
        deterministic(i, anchor);
      }
      anchorK[i] = 0.08;
    }
  } else {
    for (let i = 0; i < n; i++) {
      deterministic(i, anchor);
      anchorK[i] = 0.08;
    }
  }
  pos.set(anchor);

  // Relaxamento: cada nó se aproxima da média (ponderada) dos vizinhos e é
  // puxado de volta à âncora. Normalizar pelo grau mantém o passo < 1 mesmo
  // em hubs (a soma bruta das molas divergia). Arestas entre comunidades
  // puxam menos, preservando agrupamentos separados. O(iter * (n + e)).
  const sum = new Float32Array(n * 3);
  const wdeg = new Float32Array(n);
  const weight = new Float32Array(edges.length / 2);
  for (let e = 0, k = 0; e < edges.length; e += 2, k++) {
    const a = edges[e];
    const b = edges[e + 1];
    const w = (communities[a] ?? -1) === (communities[b] ?? -1) ? 1 : 0.06;
    weight[k] = w;
    wdeg[a] += w;
    wdeg[b] += w;
  }
  const iterations = 40;
  const springK = 0.08;
  for (let it = 0; it < iterations; it++) {
    sum.fill(0);
    for (let e = 0, k = 0; e < edges.length; e += 2, k++) {
      const a = edges[e] * 3;
      const b = edges[e + 1] * 3;
      const w = weight[k];
      for (let d = 0; d < 3; d++) {
        sum[a + d] += pos[b + d] * w;
        sum[b + d] += pos[a + d] * w;
      }
    }
    for (let i = 0; i < n; i++) {
      const k = anchorK[i];
      const dg = wdeg[i];
      for (let d = 0; d < 3; d++) {
        const j = i * 3 + d;
        const pull = dg ? (sum[j] / dg - pos[j]) * springK : 0;
        pos[j] += pull + (anchor[j] - pos[j]) * k;
      }
    }
  }

  // Grupos pequenos: o relaxamento puxa os nós para a média dos vizinhos e os
  // empilha. Afasta pares próximos demais dentro de cada comunidade pequena.
  // O(s² · iter) por comunidade, com s ≤ SMALL_GROUP.
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c = communities[i] ?? -1;
    if (sizes.get(c)! > SMALL_GROUP || sizes.get(c)! < 2) continue;
    let list = members.get(c);
    if (!list) members.set(c, (list = []));
    list.push(i);
  }
  for (const list of members.values()) {
    for (let it = 0; it < 30; it++) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const a = list[x] * 3;
          const b = list[y] * 3;
          let dx = pos[a] - pos[b];
          let dy = pos[a + 1] - pos[b + 1];
          let dz = pos[a + 2] - pos[b + 2];
          let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= NODE_GAP) continue;
          if (d < 1e-3) {
            dx = unit(fnv1a(ids[list[x]], 11)) - 0.5;
            dy = unit(fnv1a(ids[list[x]], 12)) - 0.5;
            dz = unit(fnv1a(ids[list[x]], 13)) - 0.5;
            d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          }
          const push = ((NODE_GAP - d) / d) * 0.5;
          pos[a] += dx * push;
          pos[a + 1] += dy * push;
          pos[a + 2] += dz * push;
          pos[b] -= dx * push;
          pos[b + 1] -= dy * push;
          pos[b + 2] -= dz * push;
        }
      }
    }
  }
  return { positions: pos, stars: scatteredStars(centerOf, sizes, R) };
}

/**
 * Estrelas decorativas: nuvens tênues em torno de cada comunidade (mais
 * densas nas grandes) e um fundo esparso no mesmo volume achatado. Custo fixo.
 */
function scatteredStars(centers: Map<number, [number, number, number]>, sizes: Map<number, number>, R: number): Float32Array {
  const count = 3200;
  const out = new Float32Array(count * 3);
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const list = [...centers.entries()];
  const weights = list.map(([c]) => Math.sqrt(sizes.get(c) ?? 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.72 && list.length) {
      let pick = rnd() * total;
      let k = 0;
      while (k < list.length - 1 && pick > weights[k]) pick -= weights[k++];
      const [, [cx, cy, cz]] = list[k];
      const spread = 6 + Math.sqrt(sizes.get(list[k][0]) ?? 1) * 2.2;
      out[i * 3] = cx + gauss() * spread * 1.4;
      out[i * 3 + 1] = cy + gauss() * spread * 1.0;
      out[i * 3 + 2] = cz + gauss() * spread * 1.4;
    } else {
      // fundo esparso sem contorno definido: perto de comunidades aleatórias,
      // com grande dispersão (não forma caixa, esfera nem disco).
      const [, [cx, cy, cz]] = list[Math.floor(rnd() * list.length)] ?? [0, [0, 0, 0]];
      out[i * 3] = cx + gauss() * R * 0.45;
      out[i * 3 + 1] = cy + gauss() * R * 0.3;
      out[i * 3 + 2] = cz + gauss() * R * 0.4;
    }
  }
  return out;
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { positions, stars } = layout(e.data);
  (self as unknown as Worker).postMessage({ positions, stars } satisfies LayoutResponse, [positions.buffer, stars.buffer]);
};
