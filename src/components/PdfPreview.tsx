import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Carregado sob demanda: o pdf.js é grande e só serve para esta prévia.
let lib: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return lib;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Prévia de PDF: cada página é desenhada em um <canvas> (a CSP da janela não
 * permite <iframe>/<embed>). As páginas são renderizadas quando se aproximam
 * da área visível. `fit` ajusta à largura do painel; senão vale `zoom`.
 */
export function PdfPreview({ path, version = 0 }: { path: string; version?: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    setDoc(null);
    setError(null);
    setPage(1);
    (async () => {
      try {
        const [pdfjs, b64] = await Promise.all([loadPdfjs(), invoke<string>("fs_read_bytes", { path })]);
        const t = pdfjs.getDocument({ data: decodeBase64(b64) });
        task = t;
        const loaded = await t.promise;
        if (cancelled) return void t.destroy();
        setDoc(loaded);
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setError(name === "PasswordException" ? "PDF protegido por senha" : `Não foi possível abrir o PDF: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [path, version]);

  // Largura disponível, para o modo "ajustar".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const step = (dir: 1 | -1) => {
    const cur = fit ? ZOOMS.reduce((a, z) => (Math.abs(z - 1) < Math.abs(a - 1) ? z : a), 1) : zoom;
    const i = ZOOMS.indexOf(cur);
    const next = ZOOMS[Math.min(Math.max(i + dir, 0), ZOOMS.length - 1)];
    setFit(false);
    setZoom(next);
  };

  return (
    <div className="pdf-preview">
      <div className="pdf-bar">
        <span>{doc ? `Página ${page} de ${doc.numPages}` : "PDF"}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Diminuir" onClick={() => step(-1)} disabled={!doc}>−</button>
        <span className="pdf-zoom">{fit ? "Ajustar" : `${Math.round(zoom * 100)}%`}</span>
        <button className="icon-btn" title="Aumentar" onClick={() => step(1)} disabled={!doc}>+</button>
        <button className={`btn btn-sm ${fit ? "on" : ""}`} onClick={() => setFit(true)} disabled={!doc}>Ajustar</button>
      </div>
      <div className="pdf-pages" ref={scrollRef}>
        {error && <span className="img-empty">{error}</span>}
        {!doc && !error && <span className="img-empty">Carregando…</span>}
        {doc &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} fit={fit} zoom={zoom} avail={width} root={scrollRef} onVisible={setPage} />
          ))}
      </div>
    </div>
  );
}

function PdfPage(props: {
  doc: PDFDocumentProxy;
  n: number;
  fit: boolean;
  zoom: number;
  avail: number;
  root: React.RefObject<HTMLDivElement | null>;
  onVisible: (n: number) => void;
}) {
  const { doc, n, fit, zoom, avail, root, onVisible } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Dimensões da página em escala 1 (reserva o espaço antes de renderizar).
  useEffect(() => {
    let cancelled = false;
    void doc.getPage(n).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (!cancelled) setDims({ w: v.width, h: v.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, n]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const near = new IntersectionObserver((es) => setNear(es[0].isIntersecting), { root: root.current, rootMargin: "600px 0px" });
    const mid = new IntersectionObserver((es) => es[0].isIntersecting && onVisible(n), {
      root: root.current,
      rootMargin: "-45% 0px -45% 0px",
    });
    near.observe(el);
    mid.observe(el);
    return () => {
      near.disconnect();
      mid.disconnect();
    };
  }, [n, root, onVisible]);

  const scale = dims ? (fit ? Math.max(avail - 48, 100) / dims.w : zoom) : 1;

  useEffect(() => {
    const cv = canvas.current;
    if (!near || !dims || !cv) return;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let cancelled = false;
    void doc.getPage(n).then((p) => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: scale * dpr });
      cv.width = Math.floor(viewport.width);
      cv.height = Math.floor(viewport.height);
      task = p.render({ canvas: cv, viewport });
      task.promise.catch(() => {}); // cancelamento ao re-renderizar
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, dims, doc, n, scale]);

  return (
    <div ref={box} className="pdf-page" style={dims ? { width: dims.w * scale, height: dims.h * scale } : { height: 400 }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
