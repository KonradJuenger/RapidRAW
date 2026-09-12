export interface MarqueeBox {
  startX: number;
  startY: number;
  x: number;
  y: number;
}
export default function SelectionMarquee({ box }: { box: MarqueeBox }) {
  return (
    <rect
      x={Math.min(box.startX, box.x)}
      y={Math.min(box.startY, box.y)}
      width={Math.abs(box.x - box.startX)}
      height={Math.abs(box.y - box.startY)}
      fill="color-mix(in srgb, var(--color-accent) 18%, transparent)"
      stroke="var(--color-accent)"
      strokeDasharray="3 2"
      pointerEvents="none"
    />
  );
}
