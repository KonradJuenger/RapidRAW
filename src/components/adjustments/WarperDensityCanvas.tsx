import { useEffect, useRef } from 'react';
import type { ColorWarperDistribution } from '../../store/useEditorStore';
import { wrapHueDelta, type PolarWarperState } from '../../utils/polarColorWarper';

/** Project actual sampled OKLab colors as subpixel dots, without histogram quantization. */
export default function WarperDensityCanvas({
  distribution,
  opacity,
  polar,
  spoke,
}: {
  distribution: ColorWarperDistribution | null;
  opacity: number;
  polar?: PolarWarperState;
  spoke?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const slice = spoke !== undefined;
  const limit = polar?.chromaLimit ?? 0.3;
  // The wheel projects a/b directly. Rotating or editing its mesh does not
  // change the dot layer, so retain the canvas bitmap across those updates.
  const angle = slice ? (polar?.angle ?? 0) : 0;
  const spokes = slice ? (polar?.spokes ?? 6) : 6;
  const points = distribution?.points;
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const draw = () => {
      // Match the display resolution: each dot stays small on high-DPI screens too.
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(300, Math.round(rect.width * ratio));
      canvas.height = Math.max(slice ? 240 : 300, Math.round(rect.height * ratio));
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!points) return;
      context.save();
      context.scale(canvas.width / 300, canvas.height / (slice ? 240 : 300));
      context.beginPath();
      if (slice) context.rect(12, 12, 276, 216);
      else context.arc(150, 150, 125, 0, 2 * Math.PI);
      context.clip();
      context.fillStyle = 'rgba(255,255,255,0.32)';
      const sourceHue = (angle * Math.PI) / 180 + ((spoke ?? 0) / spokes) * Math.PI * 2;
      for (const [l, a, b] of points) {
        if (![l, a, b].every(Number.isFinite)) continue;
        let x: number, y: number;
        if (slice) {
          const chroma = Math.hypot(a, b);
          if (chroma > 1e-7 && Math.abs(wrapHueDelta(Math.atan2(b, a) - sourceHue)) > Math.PI / spokes) continue;
          x = 12 + (chroma / limit) * 276;
          y = 12 + (1 - l) * 216;
        } else {
          x = 150 + (a / limit) * 125;
          y = 150 - (b / limit) * 125;
        }
        context.beginPath();
        context.arc(x, y, 0.5, 0, 2 * Math.PI);
        context.fill();
      }
      context.restore();
    };
    draw();
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.max(300, Math.round(rect.width * ratio)) ||
        canvas.height !== Math.max(slice ? 240 : 300, Math.round(rect.height * ratio))
      )
        draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [points, limit, angle, spokes, slice, spoke]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity }}
    />
  );
}
