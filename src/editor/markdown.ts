// Prévia de Markdown (como a do VS Code): converte com `marked` (GFM) e
// sanitiza com DOMPurify antes de inserir no DOM. Os dois pacotes são
// carregados sob demanda, só quando uma prévia é aberta.
import { invoke } from "@tauri-apps/api/core";
import { fsReadText } from "../lib/ipc";

let libs: Promise<{ parse: (s: string) => string; sanitize: (h: string) => string }> | null = null;

function load() {
  libs ??= Promise.all([import("marked"), import("dompurify")]).then(([m, d]) => {
    const purify = d.default;
    return {
      parse: (s: string) => m.marked.parse(s, { gfm: true, breaks: false, async: false }) as string,
      sanitize: (h: string) =>
        purify.sanitize(h, {
          USE_PROFILES: { html: true },
          // Atributos usados por READMEs (alinhamento, largura das imagens).
          ADD_ATTR: ["align", "width", "height", "target"],
          FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
        }),
    };
  });
  return libs;
}

/** Âncora no formato do GitHub ("## Por que" → "por-que"), para links internos. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export async function renderMarkdown(source: string): Promise<string> {
  const { parse, sanitize } = await load();
  return sanitize(parse(source));
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

/** Resolve `rel` (relativo ao arquivo .md) para um caminho absoluto do SO. */
export function resolveFrom(mdPath: string, rel: string): string {
  const sep = mdPath.includes("\\") ? "\\" : "/";
  const parts = mdPath.split(/[\\/]/);
  parts.pop(); // nome do arquivo .md
  for (const p of decodeURIComponent(rel.split(/[?#]/)[0]).split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.join(sep);
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const cache = new Map<string, string>();

/**
 * Converte uma imagem local do projeto em data URI (a CSP da janela não
 * permite ler arquivos do disco diretamente). SVG é lido como texto; os
 * demais formatos usam o comando `fs_read_bytes` (base64). `fresh` ignora o
 * cache (o arquivo pode ter mudado no disco).
 */
export async function localImage(absPath: string, fresh = false): Promise<string | null> {
  const hit = fresh ? undefined : cache.get(absPath);
  if (hit) return hit;
  const ext = absPath.toLowerCase().split(".").pop() ?? "";
  let url: string | null = null;
  try {
    if (ext === "svg") {
      const f = await fsReadText(absPath);
      url = svgDataUrl(f.content);
    } else if (MIME[ext]) {
      const b64 = await invoke<string>("fs_read_bytes", { path: absPath });
      url = `data:${MIME[ext]};base64,${b64}`;
    }
  } catch {
    url = null;
  }
  if (url) cache.set(absPath, url);
  return url;
}

export const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);
