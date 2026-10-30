import { Lock, LockOpen, Minimize2 } from 'lucide-react';
import {
  polarPoint,
  polarInfluence,
  movePolarSelection,
  pullPolarTogether,
  sliceInfluence,
  moveSliceSelection,
  pullSliceTogether,
  sliceLightness,
} from '../../utils/polarWarperTools';
import Slider from '../ui/Slider';
import WarperDensityCanvas from './WarperDensityCanvas';
import LightnessSlice from './LightnessSlice';
import SelectionMarquee, { type MarqueeBox } from './SelectionMarquee';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../ui/Dropdown';
import { Adjustments } from '../../utils/adjustments';
import {
  COLOR_WARPER_CHROMA_LIMITS,
  OKLAB_COLOR_SPACE,
  RAPIDRAW_DISPLAY_SRGB_D65,
  warperCoordinatesToGamutMappedWorkingRgb,
} from '../../utils/colorWarper';
import {
  createPolarWarper,
  POLAR_RINGS,
  POLAR_SPOKES,
  polarSource,
  resamplePolarWarper,
  wrapHueDelta,
  type PolarWarperState,
} from '../../utils/polarColorWarper';
import { useEditorStore } from '../../store/useEditorStore';
import { debouncedSetHistory } from '../../hooks/useEditorActions';

interface Props {
  adjustments: Adjustments;
  setAdjustments(value: Partial<Adjustments> | ((previous: Adjustments) => Adjustments)): void;
  onDragStateChange?(dragging: boolean): void;
}

const CENTER = 150;
const RADIUS = 125;
const defaultPolar = createPolarWarper();

export default function PolarColorWarper({ adjustments, setAdjustments, onDragStateChange }: Props) {
  const { t } = useTranslation();
  const polar = adjustments.colorWarper.polar ?? defaultPolar;
  const linked = adjustments.colorWarper.mode === 'linked';
  const spoke = (polar.sliceSpoke ?? 0) % polar.spokes;
  const densityOpacity = 0.85;
  const [wheelSelection, setWheelSelection] = useState<Set<number>>(new Set());
  const [sliceSelection, setSliceSelection] = useState<Set<number>>(new Set());
  const [activeView, setActiveView] = useState<'wheel' | 'slice'>('wheel');
  const angleSliderRef = useRef<PolarWarperState | null>(null);
  const [comparing, setComparing] = useState(false);
  const compareRef = useRef<{ previous: Adjustments | null; current: Adjustments; path?: string } | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedSlice, setSelectedSlice] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const background = useRef<HTMLCanvasElement>(null);
  const distribution = useEditorStore((s) => s.colorWarperDistribution);
  const [marquee, setMarquee] = useState<(MarqueeBox & { view: 'wheel' | 'slice' }) | null>(null);
  const marqueeRef = useRef<{
    box: MarqueeBox;
    view: 'wheel' | 'slice';
    svg: SVGSVGElement;
    pointerId: number;
    points: { index: number; x: number; y: number }[];
    selection: Set<number>;
    path?: string;
  } | null>(null);
  const gesture = useRef<{
    kind?: 'slice' | 'angle';
    selection?: Set<number>;
    influence?: Float32Array;
    lastX?: number;
    lastY?: number;
    dx?: number;
    dy?: number;
    lastAngle?: number;
    angleDelta?: number;
    baseline: Adjustments['colorWarper'];
    index: number;
    pointerId: number;
    svg: SVGSVGElement;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
    path?: string;
  } | null>(null);
  const dragCallback = useRef(onDragStateChange);
  dragCallback.current = onDragStateChange;

  const live = useCallback((colorWarper: Adjustments['colorWarper']) => {
    useEditorStore.getState().setEditor({
      adjustments: { ...useEditorStore.getState().adjustments, colorWarper },
      showOriginal: false,
      previewOverride: null,
    });
  }, []);

  const finish = useCallback(
    (cancel: boolean) => {
      const m = marqueeRef.current;
      if (m) {
        marqueeRef.current = null;
        setMarquee(null);
        if (!cancel && m.path === useEditorStore.getState().selectedImage?.path) {
          const { startX, startY, x, y } = m.box;
          const next = new Set(m.selection);
          for (const point of m.points) {
            if (
              point.x >= Math.min(startX, x) &&
              point.x <= Math.max(startX, x) &&
              point.y >= Math.min(startY, y) &&
              point.y <= Math.max(startY, y)
            )
              next.add(point.index);
          }
          if (m.view === 'wheel') {
            setWheelSelection(next);
            setSelected([...next].at(-1) ?? null);
            setSelectedSlice(null);
          } else {
            setSliceSelection(next);
            setSelectedSlice([...next].at(-1) ?? null);
          }
        }
        if (m.svg.hasPointerCapture(m.pointerId)) m.svg.releasePointerCapture(m.pointerId);
        return;
      }
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      const store = useEditorStore.getState();
      if (g.path === store.selectedImage?.path && store.adjustments.colorWarper.mode === g.baseline.mode) {
        if (cancel) live(g.baseline);
        else if (g.moved && JSON.stringify(store.adjustments.colorWarper.polar) !== JSON.stringify(g.baseline.polar))
          store.pushHistory(store.adjustments);
      }
      dragCallback.current?.(false);
      if (g.svg.hasPointerCapture(g.pointerId)) g.svg.releasePointerCapture(g.pointerId);
    },
    [live],
  );

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(true);
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
      finish(true);
    };
  }, [finish]);

  useEffect(() => {
    const context = background.current?.getContext('2d');
    if (!context) return;
    const image = context.createImageData(300, 300);
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        const a = ((x - CENTER) / RADIUS) * polar.chromaLimit;
        const b = ((CENTER - y) / RADIUS) * polar.chromaLimit;
        if (Math.hypot(a, b) > polar.chromaLimit) continue;
        const { rgb } = warperCoordinatesToGamutMappedWorkingRgb(RAPIDRAW_DISPLAY_SRGB_D65, OKLAB_COLOR_SPACE, [
          0.7,
          a,
          b,
        ]);
        const i = (y * 300 + x) * 4;
        for (let k = 0; k < 3; k++) image.data[i + k] = Math.round(Math.max(0, Math.min(1, rgb[k])) * 255);
        image.data[i + 3] = 190;
      }
    }
    context.putImageData(image, 0, 0);
  }, [polar.chromaLimit]);

  const update = (updater: (p: PolarWarperState) => PolarWarperState) => {
    finish(false);
    setAdjustments((previous) => ({
      ...previous,
      colorWarper: {
        ...previous.colorWarper,
        polar: updater(previous.colorWarper.polar ?? defaultPolar),
      },
    }));
  };
  const setSliceSpoke = (value: number) => {
    finish(false);
    setSliceSelection(new Set());
    setSelectedSlice(null);
    useEditorStore.getState().setEditor((store) => ({
      adjustments: {
        ...store.adjustments,
        colorWarper: {
          ...store.adjustments.colorWarper,
          polar: { ...(store.adjustments.colorWarper.polar ?? defaultPolar), sliceSpoke: value },
        },
      },
    }));
  };
  const stopCompare = useCallback(() => {
    const previous = compareRef.current;
    compareRef.current = null;
    setComparing(false);
    if (
      previous &&
      previous.path === useEditorStore.getState().selectedImage?.path &&
      useEditorStore.getState().previewOverride === previous.current
    ) {
      useEditorStore.getState().setEditor({ previewOverride: previous.previous });
    }
  }, []);
  useEffect(() => {
    window.addEventListener('blur', stopCompare);
    return () => {
      window.removeEventListener('blur', stopCompare);
      stopCompare();
    };
  }, [stopCompare]);
  const startCompare = () => {
    if (compareRef.current) return;
    finish(false);
    debouncedSetHistory.flush();
    const store = useEditorStore.getState();
    const current = {
      ...store.adjustments,
      sectionVisibility: { ...store.adjustments.sectionVisibility, colorWarper: false },
    };
    compareRef.current = { previous: store.previewOverride, current, path: store.selectedImage?.path };
    setComparing(true);
    store.setEditor({ previewOverride: current });
  };
  const align = (angle: number) => {
    if (!Number.isFinite(angle)) return;
    setSelected(null);
    setSelectedSlice(null);
    update((p) => resamplePolarWarper(p, p.spokes, p.rings, p.chromaLimit, angle));
  };
  const position = (index: number) => {
    const [a, b] = polarPoint(polar, index);
    return [CENTER + (a / polar.chromaLimit) * RADIUS, CENTER - (b / polar.chromaLimit) * RADIUS];
  };
  const choose = (index: number, additive: boolean, view: 'wheel' | 'slice') => {
    const current = view === 'wheel' ? wheelSelection : sliceSelection;
    const next = additive ? new Set(current) : current.has(index) ? new Set(current) : new Set<number>();
    if (additive && next.has(index)) next.delete(index);
    else next.add(index);
    if (view === 'wheel') {
      setWheelSelection(next);
      setSelected(index);
      setSelectedSlice(null);
    } else {
      setSliceSelection(next);
      setSelectedSlice(index);
      setSelected(index < 0 ? -1 : index % polar.offsets.length);
    }
    setActiveView(view);
    return next;
  };
  const activeSelection = activeView === 'wheel' ? wheelSelection : sliceSelection;
  const pinSelection = (locked: boolean) =>
    update((p) => {
      const next = structuredClone(p);
      next.locks ??= createPolarWarper(p.spokes, p.rings).locks;
      next.lightnessLocks ??= Array(p.offsets.length * 7).fill(false);
      for (const index of activeSelection) {
        if (index < 0) next.pinNeutrals = locked;
        else if (activeView === 'wheel') next.locks![index] = locked;
        else next.lightnessLocks[index] = locked;
      }
      return next;
    });
  const resetChannel = (channel: 'hue' | 'chroma' | 'lightness') =>
    update((p) => {
      const next = structuredClone(p);
      if (channel === 'lightness') {
        next.lightness = Array(p.offsets.length * 7).fill(0);
        next.neutralLightness = Array(7).fill(0);
      } else {
        const k = channel === 'hue' ? 0 : 1;
        next.offsets.forEach((o) => {
          o[k] = 0;
        });
        if (channel === 'chroma') next.neutral = [0, 0];
      }
      return next;
    });
  const beginMarquee = (event: React.PointerEvent<SVGSVGElement>, view: 'wheel' | 'slice') => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      event.target !== event.currentTarget ||
      gesture.current ||
      marqueeRef.current
    )
      return;
    event.preventDefault();
    const svg = event.currentTarget,
      rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 300;
    const y = ((event.clientY - rect.top) / rect.height) * (view === 'wheel' ? 300 : 240);
    const points: { index: number; x: number; y: number }[] = [];
    if (view === 'wheel') {
      for (let index = polar.pinNeutrals === false ? -1 : 0; index < polar.offsets.length; index++) {
        const [px, py] = position(index);
        points.push({ index, x: px, y: py });
      }
    } else {
      for (let layer = 1; layer < 6; layer++)
        for (let ring = polar.pinNeutrals === false ? 0 : 1; ring <= polar.rings; ring++) {
          const index = ring === 0 ? -(layer + 1) : layer * polar.offsets.length + (ring - 1) * polar.spokes + spoke;
          points.push({ index, x: 12 + (ring / polar.rings) * 276, y: 12 + (1 - sliceLightness(polar, index)) * 216 });
        }
    }
    const box = { startX: x, startY: y, x, y };
    marqueeRef.current = {
      box,
      view,
      svg,
      pointerId: event.pointerId,
      points,
      selection:
        event.ctrlKey || event.metaKey ? new Set(view === 'wheel' ? wheelSelection : sliceSelection) : new Set(),
      path: useEditorStore.getState().selectedImage?.path,
    };
    setActiveView(view);
    setMarquee({ ...box, view });
    svg.setPointerCapture(event.pointerId);
  };
  const finishPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerId === marqueeRef.current?.pointerId) {
      movePointer(event);
      finish(false);
    } else if (event.pointerId === gesture.current?.pointerId) finish(false);
  };
  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const m = marqueeRef.current;
    if (m) {
      if (event.pointerId !== m.pointerId) return;
      const rect = m.svg.getBoundingClientRect();
      m.box = {
        ...m.box,
        x: ((event.clientX - rect.left) / rect.width) * 300,
        y: ((event.clientY - rect.top) / rect.height) * (m.view === 'wheel' ? 300 : 240),
      };
      setMarquee({ ...m.box, view: m.view });
      return;
    }
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    const rect = g.svg.getBoundingClientRect();
    if (g.kind === 'angle') {
      const theta = Math.atan2(rect.top + rect.height / 2 - event.clientY, event.clientX - rect.left - rect.width / 2);
      g.angleDelta = (g.angleDelta ?? 0) + wrapHueDelta(theta - (g.lastAngle ?? g.baseX)) * (event.shiftKey ? 0.1 : 1);
      g.lastAngle = theta;
      const base = g.baseline.polar ?? defaultPolar;
      g.moved = true;
      live({
        ...g.baseline,
        polar: resamplePolarWarper(
          base,
          base.spokes,
          base.rings,
          base.chromaLimit,
          g.baseY + (g.angleDelta * 180) / Math.PI,
        ),
      });
      return;
    }
    const scale = event.shiftKey ? 0.1 : 1;
    g.dx = (g.dx ?? 0) + ((event.clientX - (g.lastX ?? g.startX)) / rect.width) * 300 * scale;
    g.dy =
      (g.dy ?? 0) + ((event.clientY - (g.lastY ?? g.startY)) / rect.height) * (g.kind === 'slice' ? 240 : 300) * scale;
    g.lastX = event.clientX;
    g.lastY = event.clientY;
    if (g.kind === 'slice') {
      const dy = g.dy / 216;
      if (!g.moved && Math.abs(dy) < 0.002) return;
      g.moved = true;
      live({
        ...g.baseline,
        polar: moveSliceSelection(
          g.baseline.polar ?? defaultPolar,
          g.selection ?? new Set([g.index]),
          -dy,
          g.influence,
        ),
      });
      return;
    }
    const dx = g.dx;
    const dy = g.dy;
    if (!g.moved && Math.hypot(dx, dy) < 0.5) return;
    g.moved = true;
    live({
      ...g.baseline,
      polar: movePolarSelection(
        g.baseline.polar ?? defaultPolar,
        g.selection ?? new Set([g.index]),
        (dx / RADIUS) * polar.chromaLimit,
        (-dy / RADIUS) * polar.chromaLimit,
        g.influence,
      ),
    });
  };
  const lines = [
    ...Array.from({ length: polar.rings }, (_, ring) =>
      Array.from({ length: polar.spokes + 1 }, (_, spoke) =>
        position(ring * polar.spokes + (spoke % polar.spokes)).join(','),
      ).join(' '),
    ),
    ...Array.from({ length: polar.spokes }, (_, spoke) =>
      [
        position(-1).join(','),
        ...Array.from({ length: polar.rings }, (_, ring) => position(ring * polar.spokes + spoke).join(',')),
      ].join(' '),
    ),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="relative aspect-square overflow-hidden rounded-md border border-border-color bg-bg-primary">
          <canvas
            ref={background}
            width={300}
            height={300}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
          />
          <WarperDensityCanvas distribution={distribution} opacity={densityOpacity} polar={polar} />
          <svg
            viewBox="0 0 300 300"
            className="absolute inset-0 h-full w-full touch-none select-none"
            onKeyDown={(event) => {
              if (linked && (event.key === '[' || event.key === ']')) {
                event.preventDefault();
                event.stopPropagation();
                setSliceSpoke((spoke + (event.key === ']' ? 1 : polar.spokes - 1)) % polar.spokes);
              }
            }}
            role="group"
            aria-label={t('adjustments.colorWarper.polarMode')}
            onPointerDown={(event) => beginMarquee(event, 'wheel')}
            onPointerMove={movePointer}
            onPointerUp={finishPointer}
            onPointerCancel={() => finish(true)}
            onLostPointerCapture={() => finish(true)}
          >
            <g fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.75" pointerEvents="none">
              {lines.map((points, i) => (
                <polyline key={i} points={points} />
              ))}
            </g>
            {linked && (
              <polyline
                points={lines[polar.rings + spoke]}
                fill="none"
                stroke="#fbbf24"
                strokeWidth={4}
                strokeDasharray="5 3"
                pointerEvents="none"
              />
            )}
            {[-1, ...polar.offsets.map((_, index) => index)].map((index) => {
              const [x, y] = position(index);
              return (
                <g key={index}>
                  <circle
                    cx={x}
                    cy={y}
                    r={7}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-pressed={wheelSelection.has(index)}
                    aria-label={
                      index < 0
                        ? t('adjustments.colorWarper.neutralPoint')
                        : t('adjustments.colorWarper.polarNodeLabel', {
                            ring: Math.floor(index / polar.spokes) + 1,
                            spoke: (index % polar.spokes) + 1,
                          })
                    }
                    className="cursor-move focus:outline-none focus:stroke-accent focus:stroke-2"
                    onPointerDown={(event) => {
                      if (event.button !== 0 || !event.isPrimary || gesture.current) return;
                      event.preventDefault();
                      if (index < 0 && polar.pinNeutrals !== false) return;
                      if (linked && event.altKey && index >= 0) {
                        setSliceSpoke(index % polar.spokes);
                        return;
                      }
                      event.currentTarget.focus();
                      const selection = choose(index, event.ctrlKey || event.metaKey, 'wheel');
                      if (!selection.has(index)) return;
                      debouncedSetHistory.flush();
                      const svg = event.currentTarget.ownerSVGElement!;
                      gesture.current = {
                        baseline: structuredClone(useEditorStore.getState().adjustments.colorWarper),
                        selection,
                        influence: polarInfluence(polar, selection),
                        index,
                        pointerId: event.pointerId,
                        svg,
                        startX: event.clientX,
                        startY: event.clientY,
                        baseX: x - CENTER,
                        baseY: CENTER - y,
                        moved: false,
                        path: useEditorStore.getState().selectedImage?.path,
                      };
                      svg.setPointerCapture(event.pointerId);
                      onDragStateChange?.(true);
                    }}
                    onPointerEnter={() => setHovered(index)}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(null)}
                    onDoubleClick={() =>
                      update((p) => {
                        const next = structuredClone(p);
                        if (index < 0) next.neutral = [0, 0];
                        else next.offsets[index] = [0, 0];
                        return next;
                      })
                    }
                    onKeyDown={(event) => {
                      if (index < 0 && polar.pinNeutrals !== false) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        choose(index, event.ctrlKey || event.metaKey, 'wheel');
                        return;
                      }
                      if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        update((p) => {
                          const next = structuredClone(p);
                          if (index < 0) next.neutral = [0, 0];
                          else next.offsets[index] = [0, 0];
                          return next;
                        });
                        return;
                      }
                      const delta: Record<string, [number, number]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, 1],
                        ArrowDown: [0, -1],
                      };
                      if (!delta[event.key]) return;
                      event.preventDefault();
                      const selection = choose(index, false, 'wheel');
                      const [dx, dy] = delta[event.key];
                      const step = event.shiftKey ? 0.1 : 1;
                      update((p) =>
                        movePolarSelection(
                          p,
                          selection,
                          ((dx * step) / RADIUS) * p.chromaLimit,
                          ((dy * step) / RADIUS) * p.chromaLimit,
                        ),
                      );
                    }}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={wheelSelection.has(index) || hovered === index ? 3.6 : 2.3}
                    fill={wheelSelection.has(index) ? '#ef4444' : hovered === index ? '#fbbf24' : 'white'}
                    stroke="black"
                    strokeWidth={(index < 0 ? polar.pinNeutrals !== false : polar.locks?.[index]) ? 2 : 0.6}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {linked &&
              Array.from({ length: polar.spokes }, (_, index) => {
                const h = polarSource(polar, index)[0];
                return (
                  <circle
                    key={index}
                    cx={CENTER + Math.cos(h) * 134}
                    cy={CENTER - Math.sin(h) * 134}
                    r={index === spoke ? 5 : 4}

                    fill={index === spoke ? '#fbbf24' : '#ddd'}
                    role="button"
                    tabIndex={0}
                    aria-label={t('adjustments.colorWarper.chooseSpoke', { spoke: index + 1 })}
                    className="cursor-pointer focus:outline-none focus:stroke-accent"
                    onClick={() => setSliceSpoke(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSliceSpoke(index);
                      }
                    }}
                  />
                );
              })}
            <circle cx={CENTER} cy={CENTER} r={145} fill="none" stroke="rgba(255,255,255,0.15)" pointerEvents="none" />
            <circle
              cx={CENTER + Math.cos(((polar.angle ?? 0) * Math.PI) / 180) * 145}
              cy={CENTER - Math.sin(((polar.angle ?? 0) * Math.PI) / 180) * 145}
              r={4}
              fill="#fbbf24"
              stroke="black"
              strokeWidth={1.5}
              role="slider"
              aria-label={t('adjustments.colorWarper.gridAngle')}
              aria-valuenow={polar.angle ?? 0}
              aria-valuemin={0}
              aria-valuemax={360}
              tabIndex={0}
              className="cursor-grab focus:outline-none focus:stroke-accent"
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  align((polar.angle ?? 0) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 0.1 : 1));
                }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary || gesture.current) return;
                event.preventDefault();
                event.currentTarget.focus();
                debouncedSetHistory.flush();
                const svg = event.currentTarget.ownerSVGElement!,
                  rect = svg.getBoundingClientRect();
                gesture.current = {
                  kind: 'angle',
                  baseline: structuredClone(useEditorStore.getState().adjustments.colorWarper),
                  index: 0,
                  pointerId: event.pointerId,
                  svg,
                  startX: event.clientX,
                  startY: event.clientY,
                  baseX: Math.atan2(
                    rect.top + rect.height / 2 - event.clientY,
                    event.clientX - rect.left - rect.width / 2,
                  ),
                  baseY: polar.angle ?? 0,
                  moved: false,
                  path: useEditorStore.getState().selectedImage?.path,
                };
                svg.setPointerCapture(event.pointerId);
                onDragStateChange?.(true);
              }}
            />
            {marquee?.view === 'wheel' && <SelectionMarquee box={marquee} />}
          </svg>
        </div>
        {linked && (
          <>
            <LightnessSlice
              polar={polar}
              distribution={distribution}
              densityOpacity={densityOpacity}
              spoke={spoke}
              hovered={hovered}
              selected={sliceSelection}
              onHover={setHovered}
              marquee={marquee?.view === 'slice' ? marquee : null}
              onBackgroundPointerDown={(event) => beginMarquee(event, 'slice')}
              onNodePointerDown={(event, index, lightness) => {
                if (event.button !== 0 || !event.isPrimary || gesture.current) return;
                event.preventDefault();
                event.currentTarget.focus();
                const selection = choose(index, event.ctrlKey || event.metaKey, 'slice');
                if (!selection.has(index)) return;
                debouncedSetHistory.flush();
                const svg = event.currentTarget.ownerSVGElement!;
                gesture.current = {
                  kind: 'slice',
                  selection,
                  influence: sliceInfluence(polar, selection),
                  baseline: structuredClone(useEditorStore.getState().adjustments.colorWarper),
                  index,
                  pointerId: event.pointerId,
                  svg,
                  startX: event.clientX,
                  startY: event.clientY,
                  baseX: 0,
                  baseY: lightness,
                  moved: false,
                  path: useEditorStore.getState().selectedImage?.path,
                };
                svg.setPointerCapture(event.pointerId);
                onDragStateChange?.(true);
              }}
              onPointerMove={movePointer}
              onPointerUp={finishPointer}
              onCancel={() => finish(true)}
              onChange={(index, value) => {
                const selection = choose(index, false, 'slice');
                update((p) => moveSliceSelection(p, selection, value - sliceLightness(p, index)));
              }}
            />
          </>
        )}
      </div>
      {linked && (
        <div className="flex items-center gap-2 text-xs" title={t('adjustments.colorWarper.sliceSpreadHint')}>
          <span className="shrink-0 text-text-secondary">{t('adjustments.colorWarper.sliceSpread')}</span>
          <Dropdown
            className="min-w-0 flex-1"
            triggerClassName="bg-surface"
            value={polar.sliceSpread ?? 'all'}
            options={[
              { value: 'all', label: t('adjustments.colorWarper.sliceSpreadAll') },
              ...Array.from({ length: polar.spokes / 2 }, (_, i) => ({
                value: i + 1,
                label:
                  i === 0
                    ? t('adjustments.colorWarper.sliceSpreadOne')
                    : t('adjustments.colorWarper.sliceSpreadReach', { reach: i + 1, neighbors: i }),
              })),
            ]}
            onChange={(value) => update((p) => ({ ...p, sliceSpread: value === 'all' ? 'all' : Number(value) }))}
          />
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <button
          className="rounded-md bg-surface px-2 py-1.5"
          aria-pressed={comparing}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            startCompare();
          }}
          onPointerUp={stopCompare}
          onPointerCancel={stopCompare}
          onLostPointerCapture={stopCompare}
          onBlur={stopCompare}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              startCompare();
            }
          }}
          onKeyUp={stopCompare}
        >
          {t('adjustments.colorWarper.holdCompare')}
        </button>
      </div>
      {selected !== null && polar.offsets[selected] && (
        <output className="text-xs tabular-nums text-text-secondary" aria-live="off">
          {t('adjustments.colorWarper.deltaReadout', {
            hue: ((polar.offsets[selected][0] * 180) / Math.PI).toFixed(1),
            chroma: polar.offsets[selected][1].toFixed(3),
            lightness: selectedSlice !== null ? ((polar.lightness?.[selectedSlice] ?? 0) * 100).toFixed(1) : '0.0',
          })}
        </output>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <label className="mr-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={polar.pinNeutrals !== false}
            onChange={(event) => update((p) => ({ ...p, pinNeutrals: event.target.checked }))}
          />
          {t('adjustments.colorWarper.pinNeutrals')}
        </label>
        <button
          className="rounded-md bg-surface p-2 disabled:opacity-40"
          disabled={!activeSelection.size}
          aria-label={t('adjustments.colorWarper.lock')}
          title={t('adjustments.colorWarper.lock')}
          onClick={() => pinSelection(true)}
        >
          <Lock size={15} />
        </button>
        <button
          className="rounded-md bg-surface p-2 disabled:opacity-40"
          disabled={!activeSelection.size}
          aria-label={t('adjustments.colorWarper.unlock')}
          title={t('adjustments.colorWarper.unlock')}
          onClick={() => pinSelection(false)}
        >
          <LockOpen size={15} />
        </button>
        <button
          className="rounded-md bg-surface p-2 disabled:opacity-40"
          disabled={activeSelection.size < 2}
          aria-label={t('adjustments.colorWarper.pullTogether')}
          title={t('adjustments.colorWarper.pullTogetherHint')}
          onClick={() =>
            update((p) =>
              activeView === 'wheel' ? pullPolarTogether(p, activeSelection) : pullSliceTogether(p, activeSelection),
            )
          }
        >
          <Minimize2 size={15} />
        </button>
      </div>
      <details className="group border-t border-border-color pt-2">
        <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">
          {t('adjustments.colorWarper.moreOptions')}
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['spokes', polar.spokes, POLAR_SPOKES],
                ['rings', polar.rings, POLAR_RINGS],
                ['range', polar.chromaLimit, COLOR_WARPER_CHROMA_LIMITS],
              ] as const
            ).map(([key, value, options]) => (
              <div key={key} className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-text-secondary">{t(`adjustments.colorWarper.${key}`)}</span>
                <Dropdown
                  className="w-full"
                  triggerClassName="bg-surface"
                  value={value}
                  options={options.map((v) => ({ value: v, label: String(v) }))}
                  onChange={(v) => {
                    setSelected(null);
                    setSelectedSlice(null);
                    setWheelSelection(new Set());
                    setSliceSelection(new Set());
                    update((p) =>
                      resamplePolarWarper(
                        p,
                        key === 'spokes' ? Number(v) : p.spokes,
                        key === 'rings' ? Number(v) : p.rings,
                        key === 'range' ? Number(v) : p.chromaLimit,
                      ),
                    );
                  }}
                />
              </div>
            ))}
          </div>
          <div
            className="text-xs"
            onBlur={() => {
              angleSliderRef.current = null;
            }}
          >
            <Slider
              label={t('adjustments.colorWarper.gridAngle')}
              min={0}
              max={359.9}
              step={0.1}
              defaultValue={0}
              suffix="°"
              value={polar.angle ?? 0}
              onDragStateChange={(dragging) => {
                if (!dragging) angleSliderRef.current = null;
                onDragStateChange?.(dragging);
              }}
              onChange={(event) => {
                angleSliderRef.current ??= structuredClone(polar);
                const base = angleSliderRef.current;
                update(() =>
                  resamplePolarWarper(base, base.spokes, base.rings, base.chromaLimit, Number(event.target.value)),
                );
              }}
              onPointerUp={() => {
                angleSliderRef.current = null;
              }}
            />
          </div>
          <div className="grid grid-cols-3 gap-1 text-xs">
            {(['hue', 'chroma', 'lightness'] as const).map((channel) => (
              <button
                key={channel}
                className="rounded-md bg-surface px-2 py-1.5 hover:bg-card-active"
                onClick={() => resetChannel(channel)}
              >
                {t(`adjustments.colorWarper.reset_${channel}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-secondary">
            {t(linked ? 'adjustments.colorWarper.linkedHelp' : 'adjustments.colorWarper.polarHelp')}
          </p>
        </div>
      </details>
    </div>
  );
}
