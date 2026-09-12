import SelectionMarquee, { type MarqueeBox } from './SelectionMarquee';
import { sliceLightness } from '../../utils/polarWarperTools';
import WarperDensityCanvas from './WarperDensityCanvas';
import type { ColorWarperDistribution } from '../../store/useEditorStore';
import { useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { POLAR_LIGHTNESS_LEVELS, polarSliceChroma, type PolarWarperState } from '../../utils/polarColorWarper';
import {
  OKLAB_COLOR_SPACE,
  RAPIDRAW_DISPLAY_SRGB_D65,
  warperCoordinatesToGamutMappedWorkingRgb,
} from '../../utils/colorWarper';

interface Props {
  polar: PolarWarperState;
  distribution: ColorWarperDistribution | null;
  densityOpacity: number;
  spoke: number;
  hovered: number | null;
  selected: ReadonlySet<number>;
  marquee: MarqueeBox | null;
  onBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>): void;
  onHover(index: number | null): void;
  onNodePointerDown(event: React.PointerEvent<SVGCircleElement>, index: number, lightness: number): void;
  onPointerMove(event: React.PointerEvent<SVGSVGElement>): void;
  onPointerUp(event: React.PointerEvent<SVGSVGElement>): void;
  onCancel(): void;
  onChange(index: number, lightness: number): void;
}

export default function LightnessSlice({
  polar,
  distribution,
  densityOpacity,
  spoke,
  hovered,
  selected,
  onHover,
  marquee,
  onBackgroundPointerDown,
  onNodePointerDown,
  onPointerMove,
  onPointerUp,
  onCancel,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const background = useRef<HTMLCanvasElement>(null);
  const count = polar.spokes * polar.rings;
  const nodes = useMemo(
    () =>
      Array.from({ length: POLAR_LIGHTNESS_LEVELS }, (_, layer) =>
        Array.from({ length: polar.rings + 1 }, (_, ring) => {
          const node = ring === 0 ? -1 : (ring - 1) * polar.spokes + spoke;
          const index = ring === 0 ? -(layer + 1) : layer * count + node;
          const sourceL = layer / (POLAR_LIGHTNESS_LEVELS - 1);
          const l = sliceLightness(polar, index);
          return {
            node,
            index,
            sourceL,
            l,
            x: 12 + (ring / polar.rings) * 276,
            y: 12 + (1 - l) * 216,
            fixed: (ring === 0 && polar.pinNeutrals !== false) || layer === 0 || layer === POLAR_LIGHTNESS_LEVELS - 1,
            locked: ring === 0 ? polar.pinNeutrals !== false : polar.lightnessLocks?.[index],
          };
        }),
      ),
    [polar, spoke, count],
  );
  const backgroundKey = JSON.stringify([
    polar.offsets,
    polar.neutral,
    polar.angle,
    polar.spokes,
    polar.rings,
    polar.chromaLimit,
    spoke,
  ]);
  useEffect(() => {
    const ctx = background.current?.getContext('2d');
    if (!ctx) return;
    const width = 96,
      height = 72;
    // This is a display guide: sample a small texture and let the browser
    // interpolate it. Keep the mesh, dots, and image processing at full precision.
    const image = ctx.createImageData(width, height);
    for (let x = 0; x < width; x++) {
      const [h, c] = polarSliceChroma(polar, spoke, x / (width - 1));
      const a = c * Math.cos(h),
        b = c * Math.sin(h);
      for (let y = 0; y < height; y++) {
        // Y is output lightness: the deformed mesh lies over the same output colors.
        // Hue/chroma are sampled in source coordinates, exactly as in the shader.
        const l = 1 - y / (height - 1);
        const { rgb } = warperCoordinatesToGamutMappedWorkingRgb(RAPIDRAW_DISPLAY_SRGB_D65, OKLAB_COLOR_SPACE, [
          l,
          a,
          b,
        ]);
        const i = (y * width + x) * 4;
        for (let k = 0; k < 3; k++) image.data[i + k] = Math.round(Math.max(0, Math.min(1, rgb[k])) * 255);
        image.data[i + 3] = 200;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [backgroundKey]);
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{t('adjustments.colorWarper.lightnessSlice')}</figcaption>
      <div className="relative aspect-[5/4] overflow-hidden rounded-md border border-border-color bg-bg-primary">
        <canvas
          ref={background}
          width={96}
          height={72}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{ left: '4%', top: '5%', width: '92%', height: '90%', imageRendering: 'auto' }}
        />
        <WarperDensityCanvas distribution={distribution} opacity={densityOpacity} polar={polar} spoke={spoke} />
        <svg
          viewBox="0 0 300 240"
          className="absolute inset-0 h-full w-full touch-none select-none"
          role="group"
          aria-label={t('adjustments.colorWarper.lightnessSlice')}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onCancel}
        >
          <g pointerEvents="none">
            {Array.from({ length: POLAR_LIGHTNESS_LEVELS }, (_, layer) => (
              <line
                key={layer}
                x1={12}
                x2={288}
                y1={12 + (layer / 6) * 216}
                y2={12 + (layer / 6) * 216}
                stroke="white"
                strokeOpacity={0.15}
                strokeDasharray="2 4"
              />
            ))}
            {nodes.map((row, layer) => (
              <polyline
                key={layer}
                points={row.map((n) => `${n.x},${n.y}`).join(' ')}
                fill="none"
                stroke="white"
                strokeOpacity={0.6}
                strokeWidth={0.75}
              />
            ))}
            {nodes[0].map((_, ring) => (
              <polyline
                key={ring}
                points={nodes.map((row) => `${row[ring].x},${row[ring].y}`).join(' ')}
                fill="none"
                stroke="white"
                strokeOpacity={0.5}
                strokeWidth={0.75}
              />
            ))}
          </g>
          {nodes.flat().map((n, i) => (
            <g key={i}>
              {!n.fixed && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={7}
                  fill="transparent"
                  role="button"
                  tabIndex={0}
                  aria-label={t('adjustments.colorWarper.sliceNode', {
                    ring: Math.floor(n.node / polar.spokes) + 1,
                    level: Math.round(n.sourceL * 100),
                  })}
                  aria-pressed={selected.has(n.index)}
                  className="cursor-ns-resize focus:outline-none focus:stroke-accent focus:stroke-2"
                  onPointerEnter={() => onHover(n.node)}
                  onPointerLeave={() => onHover(null)}
                  onFocus={() => onHover(n.node)}
                  onBlur={() => onHover(null)}
                  onPointerDown={(event) => onNodePointerDown(event, n.index, n.l)}
                  onDoubleClick={() => onChange(n.index, n.sourceL)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      event.stopPropagation();
                      onChange(n.index, n.l + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 0.001 : 0.01));
                    } else if (event.key === 'Delete' || event.key === 'Backspace') {
                      event.preventDefault();
                      event.stopPropagation();
                      onChange(n.index, n.sourceL);
                    }
                  }}
                />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={
                  selected.has(n.index) ||
                  (hovered !== null && Math.floor(hovered / polar.spokes) === Math.floor(n.node / polar.spokes))
                    ? 3.5
                    : 2.2
                }
                fill={selected.has(n.index) ? '#ef4444' : hovered === n.node ? '#fbbf24' : 'white'}
                stroke="black"
                strokeWidth={n.fixed || n.locked ? 1.8 : 0.7}
                pointerEvents="none"
              />
            </g>
          ))}
          {marquee && <SelectionMarquee box={marquee} />}
        </svg>
      </div>
      <p className="sr-only">{t('adjustments.colorWarper.sliceAxes')}</p>
    </figure>
  );
}
