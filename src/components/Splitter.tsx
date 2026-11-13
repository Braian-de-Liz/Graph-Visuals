/** Alça de redimensionamento. Reporta o deslocamento desde o início do arrasto. */
export function Splitter({
  axis,
  onStart,
  onDrag,
  className = "",
}: {
  axis: "x" | "y";
  onStart: () => void;
  onDrag: (delta: number) => void;
  className?: string;
}) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const origin = axis === "x" ? e.clientX : e.clientY;
    onStart();
    document.body.classList.add("resizing", axis === "x" ? "resizing-x" : "resizing-y");
    const move = (ev: PointerEvent) => onDrag((axis === "x" ? ev.clientX : ev.clientY) - origin);
    const up = () => {
      document.body.classList.remove("resizing", "resizing-x", "resizing-y");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={`splitter splitter-${axis} ${className}`} onPointerDown={down} />;
}
