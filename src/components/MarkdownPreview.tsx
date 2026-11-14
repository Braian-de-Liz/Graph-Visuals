import { useEffect, useRef, useState } from "react";
import { isExternal, localImage, renderMarkdown, resolveFrom, slugify } from "../editor/markdown";
import { openInEditor } from "../state/editor";
import { toast } from "../state/ui";

/**
 * Prévia renderizada do Markdown aberto no editor. Atualiza enquanto você
 * digita (com pequeno atraso). Links relativos abrem o arquivo no editor;
 * âncoras rolam a prévia; imagens do projeto são carregadas do disco.
 */
export function MarkdownPreview({ source, path }: { source: string; path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      void renderMarkdown(source).then((h) => !cancelled && setHtml(h));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [source]);

  // Pós-processamento: âncoras nos títulos e imagens locais.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const used = new Map<string, number>();
    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      let id = slugify(h.textContent ?? "");
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      h.id = id;
    });
    root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || isExternal(src) || src.startsWith("data:")) return;
      img.removeAttribute("src");
      img.classList.add("md-img-loading");
      void localImage(resolveFrom(path, src)).then((url) => {
        img.classList.remove("md-img-loading");
        if (url) img.src = url;
        else img.classList.add("md-img-missing");
      });
    });
  }, [html, path]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    e.preventDefault();
    if (href.startsWith("#")) {
      ref.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (isExternal(href)) {
      void navigator.clipboard.writeText(href).then(() => toast("Link externo copiado"));
    } else if (href) {
      openInEditor(resolveFrom(path, href));
    }
  };

  return <div ref={ref} className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
