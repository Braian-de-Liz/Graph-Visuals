import { useEffect, useState } from "react";
import { localImage, svgDataUrl } from "../editor/markdown";

/**
 * Visualização de imagem no editor: PNG/JPEG etc. lidos do disco (`path`) ou
 * SVG renderizado a partir do texto aberto (`svg`). O SVG vai como <img>, então
 * scripts embutidos não executam. Clique alterna entre ajustar e tamanho real.
 */
export function ImagePreview({ path, svg, version = 0 }: { path?: string; svg?: string; version?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [actual, setActual] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setFailed(false);
    if (svg !== undefined) {
      setUrl(svgDataUrl(svg));
      return;
    }
    if (!path) return;
    let cancelled = false;
    void localImage(path, true).then((u) => {
      if (cancelled) return;
      setUrl(u);
      setFailed(!u);
    });
    return () => {
      cancelled = true;
    };
  }, [path, svg, version]);

  return (
    <div className={`img-preview ${actual ? "actual" : ""}`}>
      {url && !failed ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onClick={() => setActual((a) => !a)}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="img-empty">{failed ? "Não foi possível exibir a imagem" : "Carregando…"}</span>
      )}
      {size && !failed && (
        <span className="img-info">
          {size.w} × {size.h} px
        </span>
      )}
    </div>
  );
}
