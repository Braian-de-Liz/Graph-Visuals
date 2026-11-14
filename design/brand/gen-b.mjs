// Gera as variantes refinadas da proposta B (Constelação).
// Uso: node design/brand/gen-b.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const C = { gold: "#D5B66A", red: "#A83242", blue: "#3F6FA6", ti: "#858B94", arc: "#39BFFF" };

// Grafo: um hub e duas pequenas comunidades ao redor.
const N = {
  H: [28, 30, 6.5, C.gold],
  a: [49, 12, 3.8, C.gold],
  a2: [42.5, 27.5, 2.1, C.gold],
  b: [54, 40, 4.4, C.red],
  b2: [45, 47.5, 2, C.red],
  c: [13.5, 47.5, 3.9, C.blue],
  d: [10, 15, 2.5, C.ti],
  d2: [22, 9, 1.8, C.ti],
  e: [35.5, 55, 2.7, C.arc],
};
const E = [
  ["H", "a", 1], ["H", "b", 1], ["H", "c", 1], ["H", "d", 1], ["H", "e", 1], ["H", "a2", 1],
  ["a2", "a", 0], ["a", "b", 0], ["b", "b2", 0], ["b2", "e", 0], ["c", "e", 0], ["d", "d2", 0], ["d2", "H", 0],
];
const STARS = [[58, 22, 0.8], [6, 31, 0.7], [50, 58, 0.7], [33, 4, 0.6], [25, 40, 0.6]];

const svg = (title, body, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">\n  <!-- ${title} -->\n` +
  (defs ? `  <defs>\n${defs}  </defs>\n` : "") +
  body +
  `</svg>\n`;

/** Encurta a aresta para não invadir os nós (desenho mais limpo). */
function seg(p, q, gap = 1.2) {
  const [x1, y1, r1] = N[p];
  const [x2, y2, r2] = N[q];
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;
  const f = (v) => +v.toFixed(2);
  return [f(x1 + ux * (r1 + gap)), f(y1 + uy * (r1 + gap)), f(x2 - ux * (r2 + gap)), f(y2 - uy * (r2 + gap))];
}

// ---------- B1 · Detalhado ----------
{
  let body = `  <circle cx="28" cy="30" r="11" stroke="${C.gold}" stroke-width="0.9" opacity="0.35"/>\n`;
  for (const [p, q, main] of E) {
    const [x1, y1, x2, y2] = seg(p, q);
    body += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.ti}" stroke-width="${main ? 1.9 : 1.2}" stroke-linecap="round" opacity="${main ? 0.8 : 0.5}"/>\n`;
  }
  for (const [x, y, r] of STARS) body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="${C.ti}" opacity="0.55"/>\n`;
  for (const [x, y, r, col] of Object.values(N)) body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>\n`;
  writeFileSync(join(here, "b1-detalhado.svg"), svg("B1 · Detalhado: hub com órbita, duas comunidades, arestas em dois pesos, poeira estelar", body));
}

// ---------- B2 · Anéis (line-art) ----------
{
  let body = "";
  for (const [p, q, main] of E) {
    const [x1, y1, x2, y2] = seg(p, q, 1.6);
    body += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.ti}" stroke-width="${main ? 1.6 : 1.1}" stroke-linecap="round" opacity="${main ? 0.75 : 0.45}"/>\n`;
  }
  for (const [k, [x, y, r, col]] of Object.entries(N)) {
    if (k === "H") {
      body += `  <circle cx="${x}" cy="${y}" r="${r + 0.4}" stroke="${col}" stroke-width="1.8"/>\n`;
      body += `  <circle cx="${x}" cy="${y}" r="${r - 2.9}" fill="${col}"/>\n`;
      body += `  <circle cx="${x}" cy="${y}" r="${r + 4.2}" stroke="${col}" stroke-width="0.8" stroke-dasharray="1.6 2.4" opacity="0.5"/>\n`;
    } else if (r >= 3) {
      body += `  <circle cx="${x}" cy="${y}" r="${r}" stroke="${col}" stroke-width="1.6"/>\n`;
      body += `  <circle cx="${x}" cy="${y}" r="${r * 0.38}" fill="${col}"/>\n`;
    } else body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>\n`;
  }
  writeFileSync(join(here, "b2-aneis.svg"), svg("B2 · Anéis: nós vazados com núcleo, hub com órbita tracejada (traço fino, técnico)", body));
}

// ---------- B3 · Gradiente ----------
{
  let defs = `    <radialGradient id="halo" cx="28" cy="30" r="17" gradientUnits="userSpaceOnUse">\n      <stop offset="0" stop-color="${C.gold}" stop-opacity="0.32"/>\n      <stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>\n    </radialGradient>\n`;
  let body = `  <circle cx="28" cy="30" r="17" fill="url(#halo)"/>\n`;
  E.forEach(([p, q, main], i) => {
    const [x1, y1, x2, y2] = seg(p, q, 0.6);
    defs += `    <linearGradient id="e${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${N[p][3]}"/><stop offset="1" stop-color="${N[q][3]}"/></linearGradient>\n`;
    body += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#e${i})" stroke-width="${main ? 2 : 1.3}" stroke-linecap="round" opacity="${main ? 0.85 : 0.55}"/>\n`;
  });
  for (const [x, y, r] of STARS) body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="${C.ti}" opacity="0.5"/>\n`;
  for (const [x, y, r, col] of Object.values(N)) {
    body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>\n`;
    if (r >= 3) body += `  <circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.35}" fill="#fff" opacity="0.18"/>\n`;
  }
  writeFileSync(join(here, "b3-gradiente.svg"), svg("B3 · Gradiente: arestas em degradê entre as cores dos nós, halo dourado no hub", body, defs));
}
console.log("ok");

// ---------- B1 · Cintilante (cores luminosas, alto contraste no preto) ----------
{
  // Tons mais luminosos dos mesmos matizes da paleta: núcleo claro → cor → borda.
  const LUM = {
    [C.gold]: ["#FFF4D2", "#F6D47C", "#C8973A"],
    [C.red]: ["#FFC7D0", "#E8475F", "#9A1F35"],
    [C.blue]: ["#D3E5FF", "#5C98EC", "#2A5698"],
    [C.ti]: ["#EEF0F3", "#B3B9C2", "#6E747D"],
    [C.arc]: ["#E3F8FF", "#4ED3FF", "#168AD0"],
  };
  const key = (col) => Object.keys(LUM).indexOf(col);
  const sparkle = (x, y, s, col, op = 1) =>
    `  <path d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z" fill="${col}" opacity="${op}"/>\n`;

  const build = (withTile) => {
    let defs = `    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8"/></filter>\n`;
    for (const [col, [c0, c1, c2]] of Object.entries(LUM))
      defs += `    <radialGradient id="n${key(col)}" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="${c0}"/><stop offset="0.45" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>\n`;
    defs += `    <radialGradient id="halo" cx="28" cy="30" r="15" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F6D47C" stop-opacity="0.28"/><stop offset="1" stop-color="#F6D47C" stop-opacity="0"/></radialGradient>\n`;

    let body = withTile
      ? `  <rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="#000"/>\n  <rect x="0.5" y="0.5" width="63" height="63" rx="14" stroke="#fff" stroke-opacity="0.08"/>\n`
      : "";
    body += `  <circle cx="28" cy="30" r="15" fill="url(#halo)"/>\n`;
    body += `  <circle cx="28" cy="30" r="11" stroke="#F6D47C" stroke-width="0.9" opacity="0.55"/>\n`;
    for (const [p, q, main] of E) {
      const [x1, y1, x2, y2] = seg(p, q);
      body += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#AEB4BD" stroke-width="${main ? 1.9 : 1.2}" stroke-linecap="round" opacity="${main ? 0.9 : 0.55}"/>\n`;
    }
    for (const [x, y, r] of STARS) body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="#EEF0F3" opacity="0.75"/>\n`;
    // brilho difuso atrás dos nós maiores
    body += `  <g filter="url(#glow)" opacity="0.85">\n`;
    for (const [x, y, r, col] of Object.values(N)) if (r >= 2.5) body += `    <circle cx="${x}" cy="${y}" r="${r}" fill="${LUM[col][1]}"/>\n`;
    body += `  </g>\n`;
    for (const [x, y, r, col] of Object.values(N)) body += `  <circle cx="${x}" cy="${y}" r="${r}" fill="url(#n${key(col)})"/>\n`;
    // cintilância: estrelas de quatro pontas no hub e em dois nós
    body += sparkle(25.6, 27.4, 2.6, "#FFFFFF", 0.95);
    body += sparkle(47.8, 10.8, 1.9, "#FFFFFF", 0.9);
    body += sparkle(36.8, 53.6, 1.5, "#FFFFFF", 0.85);
    body += sparkle(58, 22, 1.4, "#FFFFFF", 0.7);
    return svg(
      withTile ? "B1 · Cintilante (ícone): sobre placa preta" : "B1 · Cintilante: cores luminosas, brilho nos nós, alto contraste no preto",
      body,
      defs,
    );
  };
  writeFileSync(join(here, "b1-cintilante.svg"), build(false));
  writeFileSync(join(here, "b1-cintilante-icone.svg"), build(true));

  // Versão para 16–24 px: hub e quatro nós, arestas grossas, uma estrela no hub.
  {
    let d = `    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>\n`;
    for (const [col, [c0, c1, c2]] of Object.entries(LUM))
      d += `    <radialGradient id="n${key(col)}" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="${c0}"/><stop offset="0.45" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>\n`;
    const S = { H: [27, 31, 10, C.gold], a: [50, 12, 6.5, C.gold], b: [53, 44, 7, C.red], c: [12, 49, 6.5, C.blue], e: [11, 13, 5, C.arc] };
    const SE = [["H", "a"], ["H", "b"], ["H", "c"], ["H", "e"], ["a", "b"]];
    let b = "";
    for (const [p, q] of SE) {
      const [x1, y1] = S[p];
      const [x2, y2] = S[q];
      b += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#AEB4BD" stroke-width="4" stroke-linecap="round" opacity="0.85"/>\n`;
    }
    b += `  <g filter="url(#glow)" opacity="0.8">\n`;
    for (const [x, y, r, col] of Object.values(S)) b += `    <circle cx="${x}" cy="${y}" r="${r}" fill="${LUM[col][1]}"/>\n`;
    b += `  </g>\n`;
    for (const [x, y, r, col] of Object.values(S)) b += `  <circle cx="${x}" cy="${y}" r="${r}" fill="url(#n${key(col)})"/>\n`;
    b += sparkle(23.5, 27.5, 4.2, "#FFFFFF", 0.95);
    writeFileSync(join(here, "b1-cintilante-pequeno.svg"), svg("B1 · Cintilante (pequeno): para 16–24 px", b, d));
  }
}
