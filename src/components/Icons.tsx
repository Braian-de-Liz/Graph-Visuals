// Ícones de traço (24x24), desenhados para a identidade Graph Visuals.
import type { SVGProps } from "react";

type IconName =
  | "search" | "settings" | "minimize" | "maximize" | "close" | "plus" | "stop" | "star"
  | "expand" | "collapse" | "chevronRight" | "chevronDown" | "target" | "home" | "x"
  | "refresh" | "orbit" | "folder" | "folderOpen" | "file" | "code" | "save" | "panelLeft"
  | "panelRight" | "terminal" | "send" | "layers" | "trash" | "eye" | "dot" | "restore" | "compact";

const PATHS: Record<IconName, string> = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  minimize: "M5 12h14",
  maximize: "M5 5h14v14H5z",
  restore: "M8 8h11v11H8zM5 16V5h11",
  close: "M6 6l12 12M18 6L6 18",
  x: "M7 7l10 10M17 7L7 17",
  plus: "M12 5v14M5 12h14",
  stop: "M7 7h10v10H7z",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z",
  expand: "M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7",
  collapse: "M10 4v6H4M14 20v-6h6M4 4l6 6M20 20l-6-6",
  compact: "M5 9h14M5 15h14",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  target: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  home: "M12 4l8 4.5v7L12 20l-8-4.5v-7zM12 4v16M4 8.5l8 4.5 8-4.5",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  orbit: "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3 12c0-2.5 4-4.5 9-4.5s9 2 9 4.5-4 4.5-9 4.5-9-2-9-4.5z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  folderOpen: "M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12l3.5-8H7.5L5 17",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4M13.5 5l-3 14",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  panelLeft: "M4 5h16v14H4zM9 5v14",
  panelRight: "M4 5h16v14H4zM15 5v14",
  terminal: "M4 5h16v14H4zM8 10l3 2.5L8 15M13 15h4",
  send: "M4 12l16-7-6 16-3-7z",
  layers: "M12 4l9 5-9 5-9-5zM3 14l9 5 9-5",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13",
  eye: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  dot: "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
};

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Marca do Graph Visuals: hexágono com núcleo, em Vision Gold (identidade). */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden fill="none" style={{ color: "#D5B66A" }}>
      <path d="M16 3l11.3 6.5v13L16 29 4.7 22.5v-13z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 10.5l4.8 2.75v5.5L16 21.5l-4.8-2.75v-5.5z" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

/** Monograma de cada CLI: plano, monocromático. */
const AGENT_LABEL: Record<string, string> = {
  claude: "CC",
  opencode: "OC",
  codex: "CX",
  kiro: "K",
  pwsh: ">_",
  powershell: ">_",
  cmd: "C:",
};

export function AgentGlyph({ id, size = 34 }: { id: string; size?: number }) {
  return (
    <span className="agent-glyph" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {AGENT_LABEL[id] ?? id.slice(0, 2).toUpperCase()}
    </span>
  );
}
