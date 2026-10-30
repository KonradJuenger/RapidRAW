import ColorHarmonizer from './ColorHarmonizer';
import PolarColorWarper from './PolarColorWarper';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Lock, LockOpen, RotateCcw, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../ui/Dropdown';
import Slider from '../ui/Slider';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import { Adjustments } from '../../utils/adjustments';
import {
  COLOR_WARPER_CHROMA_LIMITS,
  COLOR_WARPER_DEFAULT_CHROMA_LIMIT,
  COLOR_WARPER_GRID_SIZES,
  ColorWarperGridSize,
  ColorWarperPlaneIndex,
  ColorWarperState,
  cloneColorWarper,
  computeLinearGridInfluence,
  createDefaultColorWarper,
  getPlaneNode,
  isCornerNode,
  OKLAB_COLOR_SPACE,
  RAPIDRAW_DISPLAY_SRGB_D65,
  resampleColorWarper,
  resampleColorWarperChromaLimit,
  setPlaneNode,
  warperCoordinatesToGamutMappedWorkingRgb,
} from '../../utils/colorWarper';
import { debouncedSetHistory } from '../../hooks/useEditorActions';
import { ColorWarperDistribution, useEditorStore } from '../../store/useEditorStore';

interface Props {
  adjustments: Adjustments;
  setAdjustments(value: Partial<Adjustments> | ((previous: Adjustments) => Adjustments)): void;
  onDragStateChange?(dragging: boolean): void;
}

interface SelectedNode {
  plane: ColorWarperPlaneIndex;
  index: number;
}

interface Marquee {
  plane: ColorWarperPlaneIndex;
  startX: number;
  startY: number;
  x: number;
  y: number;
  additive: boolean;
}

interface Gesture {
  baseline: Adjustments;
  startX: number;
  startY: number;
  width: number;
  height: number;
  chromaInfluences: [Float32Array, Float32Array];
  lightnessInfluences: [Float32Array, Float32Array];
  selectedByPlane: [Set<number>, Set<number>];
  didMove: boolean;
  imagePath: string | undefined;
  capture: SVGElement;
  pointerId: number;
}

const EDITOR_WIDTH = 300;
const EDITOR_HEIGHT = 240;
const PLOT_PADDING = 8;
const PLOT_WIDTH = EDITOR_WIDTH - PLOT_PADDING * 2;
const PLOT_HEIGHT = EDITOR_HEIGHT - PLOT_PADDING * 2;
const plotBackgrounds = new Map<string, ImageData>();

const keyFor = ({ plane, index }: SelectedNode) => `${plane}:${index}`;
const parseKey = (key: string): SelectedNode => {
  const [plane, index] = key.split(':').map(Number);
  return { plane: plane as ColorWarperPlaneIndex, index };
};

const nodeSource = (index: number, size: number, chromaLimit: number): [number, number] => {
  const column = index % size;
  const row = Math.floor(index / size);
  return [((column / (size - 1)) * 2 - 1) * chromaLimit, 1 - row / (size - 1)];
};

const clampOffset = (index: number, size: number, chromaLimit: number, offset: [number, number]): [number, number] => {
  const [sourceC, sourceL] = nodeSource(index, size, chromaLimit);
  return [
    Math.max(-chromaLimit - sourceC, Math.min(chromaLimit - sourceC, offset[0])),
    Math.max(-sourceL, Math.min(1 - sourceL, offset[1])),
  ];
};

function PlaneEditor({
  plane,
  active,
  state,
  selected,
  marquee,
  onNodePointerDown,
  onBackgroundPointerDown,
  onPointerMove,
  onPointerUp,
  onNodeDoubleClick,
  onNodeKeyDown,
  onPointerCancel,
  distribution,
}: {
  plane: ColorWarperPlaneIndex;
  active: boolean;
  state: ColorWarperState;
  selected: Set<string>;
  marquee: Marquee | null;
  onNodePointerDown(event: React.PointerEvent<SVGCircleElement>, node: SelectedNode): void;
  onBackgroundPointerDown(event: React.PointerEvent<SVGSVGElement>, plane: ColorWarperPlaneIndex): void;
  onPointerMove(event: React.PointerEvent<SVGSVGElement>): void;
  onPointerUp(event: React.PointerEvent<SVGSVGElement>): void;
  onNodeDoubleClick(node: SelectedNode): void;
  onNodeKeyDown(event: React.KeyboardEvent<SVGCircleElement>, node: SelectedNode): void;
  onPointerCancel(): void;
  distribution: ColorWarperDistribution | null;
}) {
  const { t } = useTranslation();
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: EDITOR_WIDTH, height: EDITOR_HEIGHT });
  const width = EDITOR_WIDTH;
  const height = EDITOR_HEIGHT;
  const size = state.gridSize;
  const chromaLimit = state.chromaLimit ?? COLOR_WARPER_DEFAULT_CHROMA_LIMIT;
  const nodes = useMemo(
    () => Array.from({ length: size * size }, (_, index) => ({ index, ...getPlaneNode(state, plane, index) })),
    [plane, size, state],
  );

  const position = useCallback(
    (index: number) => {
      const [sourceC, sourceL] = nodeSource(index, size, chromaLimit);
      const [dc, dl] = getPlaneNode(state, plane, index).offset;
      return [
        PLOT_PADDING + ((sourceC + dc + chromaLimit) / (2 * chromaLimit)) * PLOT_WIDTH,
        PLOT_PADDING + (1 - sourceL - dl) * PLOT_HEIGHT,
      ] as const;
    },
    [chromaLimit, plane, size, state],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(EDITOR_WIDTH, Math.round(entry.contentRect.width * ratio));
      const nextHeight = Math.max(EDITOR_HEIGHT, Math.round(entry.contentRect.height * ratio));
      setCanvasSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = backgroundRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const renderWidth = canvasSize.width;
    const renderHeight = canvasSize.height;
    const cacheKey = `${renderWidth}:${renderHeight}:${chromaLimit}:${plane}:${state.axisAngle}`;
    const cached = plotBackgrounds.get(cacheKey);
    if (cached) {
      context.putImageData(cached, 0, 0);
      plotBackgrounds.delete(cacheKey);
      plotBackgrounds.set(cacheKey, cached);
      return;
    }
    const plotLeft = (PLOT_PADDING / EDITOR_WIDTH) * renderWidth;
    const plotTop = (PLOT_PADDING / EDITOR_HEIGHT) * renderHeight;
    const plotWidth = (PLOT_WIDTH / EDITOR_WIDTH) * renderWidth;
    const plotHeight = (PLOT_HEIGHT / EDITOR_HEIGHT) * renderHeight;
    const image = context.createImageData(renderWidth, renderHeight);
    const angle = (state.axisAngle * Math.PI) / 180 + (plane * Math.PI) / 2;
    const axis = [Math.cos(angle), Math.sin(angle)];
    for (let y = 0; y < renderHeight; y += 1) {
      const normalizedY = Math.max(0, Math.min(1, (y - plotTop) / plotHeight));
      const lightness = 1 - normalizedY;
      for (let x = 0; x < renderWidth; x += 1) {
        const normalizedX = Math.max(0, Math.min(1, (x - plotLeft) / plotWidth));
        const chroma = (normalizedX * 2 - 1) * chromaLimit;
        const mapped = warperCoordinatesToGamutMappedWorkingRgb(RAPIDRAW_DISPLAY_SRGB_D65, OKLAB_COLOR_SPACE, [
          lightness,
          chroma * axis[0],
          chroma * axis[1],
        ]);
        const offset = (y * renderWidth + x) * 4;
        const rgb = mapped.rgb;
        image.data[offset] = Math.round(Math.max(0, Math.min(1, rgb[0])) * 255);
        image.data[offset + 1] = Math.round(Math.max(0, Math.min(1, rgb[1])) * 255);
        image.data[offset + 2] = Math.round(Math.max(0, Math.min(1, rgb[2])) * 255);
        image.data[offset + 3] = 210;
      }
    }
    context.putImageData(image, 0, 0);
    plotBackgrounds.set(cacheKey, image);
    if (plotBackgrounds.size > 4) plotBackgrounds.delete(plotBackgrounds.keys().next().value!);
  }, [canvasSize, chromaLimit, plane, state.axisAngle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const plotLeft = (PLOT_PADDING / EDITOR_WIDTH) * canvas.width;
    const plotTop = (PLOT_PADDING / EDITOR_HEIGHT) * canvas.height;
    const plotWidth = (PLOT_WIDTH / EDITOR_WIDTH) * canvas.width;
    const plotHeight = (PLOT_HEIGHT / EDITOR_HEIGHT) * canvas.height;
    const currentDistribution = distribution;
    const values = currentDistribution?.planes[plane];
    if (currentDistribution && values?.length === currentDistribution.width * currentDistribution.height) {
      context.save();
      context.globalCompositeOperation = 'screen';
      values.forEach((density, index) => {
        if (density <= 0.015) return;
        const column = index % currentDistribution.width;
        const row = Math.floor(index / currentDistribution.width);
        const x = plotLeft + (column / (currentDistribution.width - 1)) * plotWidth;
        const y = plotTop + (row / (currentDistribution.height - 1)) * plotHeight;
        const alpha = 0.12 + Math.pow(Math.min(1, density), 0.65) * 0.72;
        context.fillStyle = `rgba(255,255,255,${alpha})`;
        const pointSize = density > 0.5 ? 2 : 1;
        context.fillRect(Math.round(x), Math.round(y), pointSize, pointSize);
      });
      context.restore();
    }
  }, [canvasSize, distribution, plane]);

  const rows = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => position(row * size + column).join(',')).join(' '),
  );
  const columns = Array.from({ length: size }, (_, column) =>
    Array.from({ length: size }, (_, row) => position(row * size + column).join(',')).join(' '),
  );

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs text-text-secondary">
        {t(plane === 0 ? 'adjustments.colorWarper.planeA' : 'adjustments.colorWarper.planeB')}
      </figcaption>
      <div
        ref={containerRef}
        className={`relative aspect-[5/4] overflow-hidden rounded-md border bg-bg-primary ${active ? 'border-accent' : 'border-border-color'}`}
      >
        <canvas
          ref={backgroundRef}
          width={canvasSize.width}
          height={canvasSize.height}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full opacity-80"
        />
        <canvas
          aria-hidden="true"
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="absolute inset-0 h-full w-full opacity-80"
        />
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full touch-none select-none"
          onPointerDown={(event) => onBackgroundPointerDown(event, plane)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onPointerCancel}
          role="group"
          aria-label={t(plane === 0 ? 'adjustments.colorWarper.planeA' : 'adjustments.colorWarper.planeB')}
        >
          {/* Static reference lines: diagonals and center crosshairs */}
          <g pointerEvents="none" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6">
            <line x1={PLOT_PADDING} y1={PLOT_PADDING} x2={PLOT_PADDING + PLOT_WIDTH} y2={PLOT_PADDING + PLOT_HEIGHT} />
            <line x1={PLOT_PADDING + PLOT_WIDTH} y1={PLOT_PADDING} x2={PLOT_PADDING} y2={PLOT_PADDING + PLOT_HEIGHT} />
            <line
              x1={PLOT_PADDING + PLOT_WIDTH / 2}
              y1={PLOT_PADDING}
              x2={PLOT_PADDING + PLOT_WIDTH / 2}
              y2={PLOT_PADDING + PLOT_HEIGHT}
            />
            <line
              x1={PLOT_PADDING}
              y1={PLOT_PADDING + PLOT_HEIGHT / 2}
              x2={PLOT_PADDING + PLOT_WIDTH}
              y2={PLOT_PADDING + PLOT_HEIGHT / 2}
            />
          </g>
          <g pointerEvents="none" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="0.75">
            {[...rows, ...columns].map((points, index) => (
              <polyline key={index} points={points} />
            ))}
          </g>
          {nodes.map((node) => {
            const [x, y] = position(node.index);
            const isSelected = selected.has(keyFor({ plane, index: node.index }));
            return (
              <g key={node.index}>
                <circle
                  cx={x}
                  cy={y}
                  r={7}
                  fill="transparent"
                  className="cursor-move focus:outline-none focus:stroke-accent focus:stroke-2"
                  tabIndex={0}
                  role="button"
                  aria-label={t('adjustments.colorWarper.nodeLabel', {
                    row: Math.floor(node.index / size) + 1,
                    column: (node.index % size) + 1,
                  })}
                  aria-pressed={isSelected}
                  onKeyDown={(event) => onNodeKeyDown(event, { plane, index: node.index })}
                  onPointerDown={(event) => onNodePointerDown(event, { plane, index: node.index })}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onNodeDoubleClick({ plane, index: node.index });
                  }}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 3.6 : node.locked ? 2.8 : 2.0}
                  fill={isSelected ? '#ef4444' : '#ffffff'}
                  stroke={isSelected ? '#000000' : node.locked ? '#000000' : 'rgba(0,0,0,0.35)'}
                  strokeWidth={isSelected ? 1.5 : node.locked ? 1.8 : 0.6}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {marquee?.plane === plane && (
            <rect
              x={Math.min(marquee.startX, marquee.x)}
              y={Math.min(marquee.startY, marquee.y)}
              width={Math.abs(marquee.x - marquee.startX)}
              height={Math.abs(marquee.y - marquee.startY)}
              fill="color-mix(in srgb, var(--color-accent) 18%, transparent)"
              stroke="var(--color-accent)"
              strokeDasharray="3 2"
            />
          )}
        </svg>
      </div>
    </figure>
  );
}

function GridColorWarper({ adjustments, setAdjustments, onDragStateChange }: Props) {
  const { t } = useTranslation();
  const state = adjustments.colorWarper;
  const chromaLimit = state.chromaLimit ?? COLOR_WARPER_DEFAULT_CHROMA_LIMIT;
  const distribution = useEditorStore((editor) => editor.colorWarperDistribution);
  const historyIndex = useEditorStore((editor) => editor.historyIndex);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activePlane, setActivePlane] = useState<ColorWarperPlaneIndex>(0);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const keepSelectionForHistoryRef = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const updateLive = useCallback((colorWarper: ColorWarperState) => {
    useEditorStore.getState().setEditor((editor) => ({
      adjustments: { ...editor.adjustments, colorWarper },
      showOriginal: false,
      previewOverride: null,
    }));
  }, []);

  const beginGesture = useCallback(
    (event: React.PointerEvent<SVGCircleElement>, node: SelectedNode) => {
      if (event.button !== 0 || !event.isPrimary || gestureRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setActivePlane(node.plane);
      const key = keyFor(node);
      let nextSelection = new Set(selectedRef.current);
      if (event.ctrlKey || event.metaKey) {
        if (nextSelection.has(key)) nextSelection.delete(key);
        else nextSelection.add(key);
      } else if (!nextSelection.has(key)) {
        nextSelection = new Set([key]);
      }
      setSelected(nextSelection);
      selectedRef.current = nextSelection;
      if (!nextSelection.has(key)) return;

      debouncedSetHistory.flush();
      const baseline = structuredClone(useEditorStore.getState().adjustments) as Adjustments;
      const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!rect) return;
      const selectedByPlane = [new Set<number>(), new Set<number>()] as [Set<number>, Set<number>];
      const lockedByPlane = [new Set<number>(), new Set<number>()] as [Set<number>, Set<number>];
      for (const item of nextSelection) {
        const parsed = parseKey(item);
        selectedByPlane[parsed.plane].add(parsed.index);
      }
      for (const plane of [0, 1] as ColorWarperPlaneIndex[]) {
        for (let index = 0; index < state.gridSize * state.gridSize; index += 1) {
          if (getPlaneNode(state, plane, index).locked && !selectedByPlane[plane].has(index)) {
            lockedByPlane[plane].add(index);
          }
        }
      }
      const center = Math.floor(state.gridSize / 2);
      const chromaInfluences = ([0, 1] as ColorWarperPlaneIndex[]).map((plane) => {
        return computeLinearGridInfluence(state.gridSize, selectedByPlane[plane], lockedByPlane[plane]);
      }) as [Float32Array, Float32Array];
      const lightnessInfluences = ([0, 1] as ColorWarperPlaneIndex[]).map((plane) => {
        if (selectedByPlane[plane].size > 0) {
          return computeLinearGridInfluence(state.gridSize, selectedByPlane[plane], lockedByPlane[plane]);
        }
        const otherPlane = plane === 0 ? 1 : 0;
        const middleSelected = new Set<number>();
        for (const idx of selectedByPlane[otherPlane]) {
          if (idx % state.gridSize === center) middleSelected.add(idx);
        }
        return computeLinearGridInfluence(state.gridSize, middleSelected, lockedByPlane[plane]);
      }) as [Float32Array, Float32Array];
      gestureRef.current = {
        baseline,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width * (PLOT_WIDTH / EDITOR_WIDTH),
        height: rect.height * (PLOT_HEIGHT / EDITOR_HEIGHT),
        chromaInfluences,
        lightnessInfluences,
        selectedByPlane,
        didMove: false,
        imagePath: useEditorStore.getState().selectedImage?.path,
        capture: event.currentTarget.ownerSVGElement!,
        pointerId: event.pointerId,
      };
      gestureRef.current.capture.setPointerCapture(event.pointerId);
      onDragStateChange?.(true);
    },
    [onDragStateChange, state],
  );

  const moveGesture = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (marquee) {
        const rect = event.currentTarget.getBoundingClientRect();
        setMarquee((current) =>
          current
            ? {
                ...current,
                x: ((event.clientX - rect.left) / rect.width) * EDITOR_WIDTH,
                y: ((event.clientY - rect.top) / rect.height) * EDITOR_HEIGHT,
              }
            : null,
        );
        return;
      }
      const gesture = gestureRef.current;
      if (
        !gesture ||
        event.pointerId !== gesture.pointerId ||
        gesture.imagePath !== useEditorStore.getState().selectedImage?.path
      )
        return;
      event.preventDefault();
      const fine = event.shiftKey || event.altKey ? 0.1 : 1;
      const dc = ((event.clientX - gesture.startX) / gesture.width) * (2 * chromaLimit) * fine;
      const dl = (-(event.clientY - gesture.startY) / gesture.height) * fine;
      if (Math.abs(dc) < 1e-8 && Math.abs(dl) < 1e-8) {
        if (gesture.didMove) updateLive(cloneColorWarper(gesture.baseline.colorWarper));
        gesture.didMove = false;
        return;
      }
      gesture.didMove = true;
      const next = cloneColorWarper(gesture.baseline.colorWarper);
      for (const plane of [0, 1] as ColorWarperPlaneIndex[]) {
        for (let index = 0; index < next.gridSize * next.gridSize; index += 1) {
          const chromaInfluence = gesture.chromaInfluences[plane][index];
          const lightnessInfluence = gesture.lightnessInfluences[plane][index];
          if (chromaInfluence <= 0.00001 && lightnessInfluence <= 0.00001) continue;
          const base = getPlaneNode(gesture.baseline.colorWarper, plane, index).offset;
          const isDirectlyManipulated = gesture.selectedByPlane[plane].has(index);
          const isLocked = isDirectlyManipulated || getPlaneNode(gesture.baseline.colorWarper, plane, index).locked;
          setPlaneNode(
            next,
            plane,
            index,
            clampOffset(index, next.gridSize, chromaLimit, [
              base[0] + dc * chromaInfluence,
              base[1] + dl * lightnessInfluence,
            ]),
            isLocked,
          );
        }
      }
      updateLive(next);
    },
    [chromaLimit, marquee, updateLive],
  );

  const finishPointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (marquee) {
        const minX = Math.min(marquee.startX, marquee.x);
        const maxX = Math.max(marquee.startX, marquee.x);
        const minY = Math.min(marquee.startY, marquee.y);
        const maxY = Math.max(marquee.startY, marquee.y);
        const next = marquee.additive ? new Set(selectedRef.current) : new Set<string>();
        for (let index = 0; index < state.gridSize * state.gridSize; index += 1) {
          const [sourceC, sourceL] = nodeSource(index, state.gridSize, chromaLimit);
          const [dc, dl] = getPlaneNode(state, marquee.plane, index).offset;
          const x = PLOT_PADDING + ((sourceC + dc + chromaLimit) / (2 * chromaLimit)) * PLOT_WIDTH;
          const y = PLOT_PADDING + (1 - sourceL - dl) * PLOT_HEIGHT;
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) next.add(keyFor({ plane: marquee.plane, index }));
        }
        setSelected(next);
        setMarquee(null);
        return;
      }
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gestureRef.current = null;
      onDragStateChange?.(false);
      if (gesture.didMove) {
        keepSelectionForHistoryRef.current = true;
        useEditorStore.getState().pushHistory(useEditorStore.getState().adjustments);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [chromaLimit, marquee, onDragStateChange, state],
  );

  const beginMarquee = useCallback((event: React.PointerEvent<SVGSVGElement>, plane: ColorWarperPlaneIndex) => {
    if (event.button !== 0 || !event.isPrimary || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * EDITOR_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * EDITOR_HEIGHT;
    setActivePlane(plane);
    setMarquee({ plane, startX: x, startY: y, x, y, additive: event.ctrlKey || event.metaKey });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const dragCallbackRef = useRef(onDragStateChange);
  dragCallbackRef.current = onDragStateChange;
  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setMarquee(null);
    if (!gesture) return;
    if (
      gesture.imagePath === useEditorStore.getState().selectedImage?.path &&
      gesture.baseline.colorWarper.gridSize === useEditorStore.getState().adjustments.colorWarper.gridSize
    ) {
      updateLive(gesture.baseline.colorWarper);
    }
    dragCallbackRef.current?.(false);
    if (gesture.capture.hasPointerCapture(gesture.pointerId)) gesture.capture.releasePointerCapture(gesture.pointerId);
  }, [updateLive]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGesture();
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      cancelGesture();
    };
  }, [cancelGesture]);

  useEffect(() => {
    if (keepSelectionForHistoryRef.current) {
      keepSelectionForHistoryRef.current = false;
      return;
    }
    setSelected(new Set());
    selectedRef.current = new Set();
    setMarquee(null);
  }, [historyIndex]);

  const updateState = (updater: (current: ColorWarperState) => ColorWarperState) => {
    setAdjustments((previous) => ({ ...previous, colorWarper: updater(previous.colorWarper) }));
  };

  if (state.unsupportedState !== undefined) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border-color bg-surface p-3">
        <Text variant={TextVariants.body} color={TextColors.secondary}>
          {t('adjustments.colorWarper.unsupported')}
        </Text>
        <button
          className="self-start rounded-md bg-card-active px-2 py-1.5 text-xs hover:bg-button-hover"
          onClick={() => updateState(() => createDefaultColorWarper())}
        >
          {t('adjustments.colorWarper.resetAll')}
        </button>
      </div>
    );
  }

  const onNodeKeyDown = (event: React.KeyboardEvent<SVGCircleElement>, node: SelectedNode) => {
    const key = keyFor(node);
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const next = event.ctrlKey || event.metaKey ? new Set(selectedRef.current) : new Set<string>();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selectedRef.current = next;
      setSelected(next);
      setActivePlane(node.plane);
      return;
    }
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    setActivePlane(node.plane);
    const targets = selectedRef.current.has(key) ? selectedRef.current : new Set([key]);
    selectedRef.current = targets;
    setSelected(targets);
    const step = event.shiftKey || event.altKey ? 0.001 : 0.01;
    updateState((current) => {
      const next = cloneColorWarper(current);
      const neutralRows = new Set<number>();
      for (const target of targets) {
        const selectedNode = parseKey(target);
        if (selectedNode.index >= next.gridSize * next.gridSize) continue;
        const base = getPlaneNode(next, selectedNode.plane, selectedNode.index).offset;
        const row = Math.floor(selectedNode.index / next.gridSize);
        const neutral = selectedNode.index % next.gridSize === Math.floor(next.gridSize / 2);
        const lightnessDelta = neutral && neutralRows.has(row) ? 0 : delta[1] * step;
        if (neutral) neutralRows.add(row);
        setPlaneNode(
          next,
          selectedNode.plane,
          selectedNode.index,
          clampOffset(selectedNode.index, next.gridSize, chromaLimit, [
            base[0] + delta[0] * step * 2 * chromaLimit,
            base[1] + lightnessDelta,
          ]),
          true,
        );
      }
      return next;
    });
    keepSelectionForHistoryRef.current = true;
  };

  const lockSelected = (locked: boolean) =>
    updateState((current) => {
      const next = cloneColorWarper(current);
      for (const key of selected) {
        const node = parseKey(key);
        setPlaneNode(next, node.plane, node.index, getPlaneNode(next, node.plane, node.index).offset, locked);
      }
      return next;
    });

  const resetSelected = (nodeOnly?: SelectedNode) =>
    updateState((current) => {
      const next = cloneColorWarper(current);
      const targets = nodeOnly ? [keyFor(nodeOnly)] : [...selected];
      for (const key of targets) {
        const node = parseKey(key);
        setPlaneNode(next, node.plane, node.index, [0, 0]);
      }
      return next;
    });

  const resetPlane = () =>
    updateState((current) => {
      const next = cloneColorWarper(current);
      const center = Math.floor(next.gridSize / 2);
      for (let index = 0; index < next.gridSize * next.gridSize; index += 1) {
        if (index % next.gridSize === center) continue;
        setPlaneNode(next, activePlane, index, [0, 0], isCornerNode(index, next.gridSize));
      }
      for (let row = 0; row < next.gridSize; row += 1) next.neutralAxis.offsets[row][activePlane] = 0;
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <PlaneEditor
        plane={0}
        active={activePlane === 0}
        state={state}
        distribution={distribution}
        selected={selected}
        marquee={marquee}
        onNodePointerDown={beginGesture}
        onBackgroundPointerDown={beginMarquee}
        onPointerMove={moveGesture}
        onPointerUp={finishPointer}
        onNodeDoubleClick={(node) => resetSelected(node)}
        onNodeKeyDown={onNodeKeyDown}
        onPointerCancel={cancelGesture}
      />
      <PlaneEditor
        plane={1}
        active={activePlane === 1}
        state={state}
        distribution={distribution}
        selected={selected}
        marquee={marquee}
        onNodePointerDown={beginGesture}
        onBackgroundPointerDown={beginMarquee}
        onPointerMove={moveGesture}
        onPointerUp={finishPointer}
        onNodeDoubleClick={(node) => resetSelected(node)}
        onNodeKeyDown={onNodeKeyDown}
        onPointerCancel={cancelGesture}
      />
      <div className="flex items-center gap-1">
        <button
          className="p-2 rounded-md bg-surface hover:bg-card-active disabled:opacity-40"
          disabled={!selected.size}
          onClick={() => lockSelected(true)}
          aria-label={t('adjustments.colorWarper.lock')}
          data-tooltip={t('adjustments.colorWarper.lock')}
        >
          <Lock size={15} />
        </button>
        <button
          className="p-2 rounded-md bg-surface hover:bg-card-active disabled:opacity-40"
          disabled={!selected.size}
          onClick={() => lockSelected(false)}
          aria-label={t('adjustments.colorWarper.unlock')}
          data-tooltip={t('adjustments.colorWarper.unlock')}
        >
          <LockOpen size={15} />
        </button>
        <button
          className="p-2 rounded-md bg-surface hover:bg-card-active disabled:opacity-40"
          disabled={!selected.size}
          onClick={() => resetSelected()}
          aria-label={t('adjustments.colorWarper.resetSelected')}
          data-tooltip={t('adjustments.colorWarper.resetSelected')}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="p-2 rounded-md bg-surface hover:bg-card-active"
          onClick={resetPlane}
          aria-label={t('adjustments.colorWarper.resetPlane')}
          data-tooltip={t('adjustments.colorWarper.resetPlane')}
        >
          <RotateCcw size={15} />
        </button>
        <button
          className="ml-auto px-2 py-1.5 rounded-md bg-surface hover:bg-card-active text-xs"
          onClick={() => {
            setSelected(new Set());
            updateState(() => ({ ...createDefaultColorWarper(), mode: 'grid' }));
          }}
        >
          {t('adjustments.colorWarper.resetAll')}
        </button>
      </div>
      <details className="group border-t border-border-color pt-2">
        <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">
          {t('adjustments.colorWarper.moreOptions')}
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <div className="grid grid-cols-2 items-end gap-2">
            <div className="flex min-w-0 flex-col gap-1" data-tooltip={t('adjustments.colorWarper.rangeHint')}>
              <Text variant={TextVariants.label} color={TextColors.secondary}>
                {t('adjustments.colorWarper.range')}
              </Text>
              <Dropdown
                className="w-full"
                triggerClassName="bg-surface"
                value={state.chromaLimit ?? COLOR_WARPER_DEFAULT_CHROMA_LIMIT}
                options={COLOR_WARPER_CHROMA_LIMITS.map((limit) => ({
                  value: limit,
                  label: limit.toFixed(2),
                }))}
                onChange={(limit) => {
                  setSelected(new Set());
                  updateState((current) => resampleColorWarperChromaLimit(current, Number(limit)));
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1" data-tooltip={t('adjustments.colorWarper.densityHint')}>
              <Text variant={TextVariants.label} color={TextColors.secondary}>
                {t('adjustments.colorWarper.grid')}
              </Text>
              <Dropdown
                className="w-full"
                triggerClassName="bg-surface"
                value={state.gridSize}
                options={COLOR_WARPER_GRID_SIZES.map((size) => ({ value: size, label: `${size} × ${size}` }))}
                onChange={(size) => {
                  setSelected(new Set());
                  updateState((current) => resampleColorWarper(current, size as ColorWarperGridSize));
                }}
              />
            </div>
          </div>

          <Slider
            label={t('adjustments.colorWarper.axisAngle')}
            min={-180}
            max={180}
            step={1}
            defaultValue={0}
            suffix="°"
            value={state.axisAngle > 180 ? state.axisAngle - 360 : state.axisAngle}
            onChange={(event) =>
              updateState((current) => ({ ...cloneColorWarper(current), axisAngle: Number(event.target.value) }))
            }
            onDragStateChange={onDragStateChange}
          />

          <p className="text-xs text-text-secondary">{t('adjustments.colorWarper.help')}</p>
        </div>
      </details>{' '}
    </div>
  );
}

export default function ColorWarper(props: Props) {
  const { t } = useTranslation();
  const state = props.adjustments.colorWarper;
  const polarCoordinates = state.mode === 'polar' || state.mode === 'linked' || state.mode === 'harmony';
  const displayLimit =
    state.mode === 'harmony'
      ? state.harmonizer?.polar.chromaLimit
      : polarCoordinates
        ? state.polar?.chromaLimit
        : state.chromaLimit;
  useLayoutEffect(() => {
    useEditorStore.getState().setEditor({ colorWarperDistribution: null });
  }, [polarCoordinates, displayLimit]);
  if (state.unsupportedState !== undefined) return <GridColorWarper {...props} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Text variant={TextVariants.label} color={TextColors.secondary}>
          {t('adjustments.colorWarper.mode')}
        </Text>
        <Dropdown
          className="w-full"
          triggerClassName="bg-surface"
          value={state.mode ?? 'grid'}
          options={[
            { value: 'harmony', label: t('adjustments.colorWarper.harmonyMode') },
            { value: 'linked', label: t('adjustments.colorWarper.linkedMode') },
            { value: 'polar', label: t('adjustments.colorWarper.polarMode') },
            { value: 'grid', label: t('adjustments.colorWarper.gridMode') },
          ]}
          onChange={(mode) =>
            props.setAdjustments((previous) => ({
              ...previous,
              colorWarper: { ...previous.colorWarper, mode: mode as 'grid' | 'polar' | 'linked' | 'harmony' },
            }))
          }
        />
      </div>
      {state.mode === 'harmony' ? (
        <ColorHarmonizer {...props} />
      ) : state.mode === 'polar' || state.mode === 'linked' ? (
        <PolarColorWarper {...props} />
      ) : (
        <GridColorWarper {...props} />
      )}
    </div>
  );
}
