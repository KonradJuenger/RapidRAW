export const POLAR_LIGHTNESS_LEVELS = 7;
export const POLAR_SPOKES = [6, 8, 12, 16, 24] as const;
export const POLAR_RINGS = [3, 4, 6, 8, 12] as const;

export interface PolarWarperState {
  pinNeutrals?: boolean;
  locks?: boolean[];
  lightnessLocks?: boolean[];
  neutral?: [number, number];
  neutralLightness?: number[];
  /** Layer-major lightness offsets; source hue/chroma membership never changes. */
  lightness?: number[];
  /** Alignment in degrees; rotating resamples the existing color transform. */
  angle?: number;
  /** Display-only source spoke for the slice histogram. */
  sliceSpoke?: number;
  /** Editing influence setting; existing lightness offsets are unaffected. */
  sliceSpread?: 'all' | number;
  spokes: number;
  rings: number;
  chromaLimit: number;
  /** Ring-major hue (radians) and chroma offsets. The neutral center is fixed. */
  offsets: [number, number][];
}

export const createPolarWarper = (spokes = 6, rings = 6, chromaLimit = 0.3): PolarWarperState => ({
  pinNeutrals: true,
  locks: Array.from({ length: spokes * rings }, (_, i) => Math.floor(i / spokes) === rings - 1),
  lightnessLocks: Array(spokes * rings * POLAR_LIGHTNESS_LEVELS).fill(false),
  neutral: [0, 0],
  neutralLightness: Array(POLAR_LIGHTNESS_LEVELS).fill(0),
  lightness: Array(spokes * rings * POLAR_LIGHTNESS_LEVELS).fill(0),
  angle: 0,
  sliceSpoke: 0,
  sliceSpread: 'all',
  spokes,
  rings,
  chromaLimit,
  offsets: Array.from({ length: spokes * rings }, () => [0, 0]),
});

export function normalizePolarWarper(raw: unknown): PolarWarperState | null {
  if (raw === undefined) return createPolarWarper();
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as PolarWarperState;
  if (
    (p.angle !== undefined && (!Number.isFinite(p.angle) || p.angle < 0 || p.angle >= 360)) ||
    (p.sliceSpoke !== undefined && (!Number.isInteger(p.sliceSpoke) || p.sliceSpoke < 0 || p.sliceSpoke >= p.spokes)) ||
    (p.sliceSpread !== undefined &&
      p.sliceSpread !== 'all' &&
      (!Number.isInteger(p.sliceSpread) || p.sliceSpread < 1 || p.sliceSpread > p.spokes / 2)) ||
    !(POLAR_SPOKES as readonly number[]).includes(p.spokes) ||
    !(POLAR_RINGS as readonly number[]).includes(p.rings) ||
    !Number.isFinite(p.chromaLimit) ||
    p.chromaLimit < 0.1 ||
    p.chromaLimit > 1 ||
    !Array.isArray(p.offsets) ||
    p.offsets.length !== p.spokes * p.rings ||
    !p.offsets.every(
      (o, i) =>
        Array.isArray(o) &&
        o.length === 2 &&
        o.every(Number.isFinite) &&
        Math.abs(o[0]) <= Math.PI + 1e-8 &&
        polarSource(p, i)[1] + o[1] >= -1e-8 &&
        polarSource(p, i)[1] + o[1] <= p.chromaLimit + 1e-8,
    )
  )
    return null;
  if (
    p.lightness !== undefined &&
    (!Array.isArray(p.lightness) ||
      p.lightness.length !== p.spokes * p.rings * POLAR_LIGHTNESS_LEVELS ||
      !p.lightness.every((d, i) => {
        const layer = Math.floor(i / (p.spokes * p.rings));
        const l = layer / (POLAR_LIGHTNESS_LEVELS - 1);
        return (
          Number.isFinite(d) &&
          l + d >= -1e-8 &&
          l + d <= 1 + 1e-8 &&
          ((layer !== 0 && layer !== POLAR_LIGHTNESS_LEVELS - 1) || d === 0)
        );
      }))
  )
    return null;
  const defaults = createPolarWarper(p.spokes, p.rings, p.chromaLimit);
  const validLocks = (v: unknown, count: number) =>
    v === undefined || (Array.isArray(v) && v.length === count && v.every((b) => typeof b === 'boolean'));
  if (
    (p.pinNeutrals !== undefined && typeof p.pinNeutrals !== 'boolean') ||
    !validLocks(p.locks, p.spokes * p.rings) ||
    !validLocks(p.lightnessLocks, p.spokes * p.rings * 7) ||
    (p.neutral !== undefined &&
      (!Array.isArray(p.neutral) ||
        p.neutral.length !== 2 ||
        !p.neutral.every(Number.isFinite) ||
        Math.hypot(...p.neutral) > p.chromaLimit + 1e-8)) ||
    (p.neutralLightness !== undefined &&
      (!Array.isArray(p.neutralLightness) ||
        p.neutralLightness.length !== 7 ||
        !p.neutralLightness.every(
          (d, i) =>
            Number.isFinite(d) && i / 6 + d >= -1e-8 && i / 6 + d <= 1 + 1e-8 && ((i !== 0 && i !== 6) || d === 0),
        )))
  )
    return null;
  return {
    ...structuredClone(p),
    pinNeutrals: p.pinNeutrals ?? true,
    locks: p.locks?.slice() ?? defaults.locks,
    lightnessLocks: p.lightnessLocks?.slice() ?? defaults.lightnessLocks,
    neutral: (p.neutral?.slice() as [number, number]) ?? [0, 0],
    neutralLightness: p.neutralLightness?.slice() ?? defaults.neutralLightness,
    angle: p.angle ?? 0,
    sliceSpoke: p.sliceSpoke ?? 0,
    sliceSpread: p.sliceSpread ?? 'all',
    lightness: p.lightness?.slice() ?? Array(p.spokes * p.rings * POLAR_LIGHTNESS_LEVELS).fill(0),
  };
}

export const polarSource = (p: PolarWarperState, index: number): [number, number] => [
  ((index % p.spokes) / p.spokes) * Math.PI * 2 + ((p.angle ?? 0) * Math.PI) / 180,
  ((Math.floor(index / p.spokes) + 1) / p.rings) * p.chromaLimit,
];

export const wrapHueDelta = (h: number): number =>
  ((((h + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Periodic hue interpolation, fading to the fixed neutral center. Mirrors WGSL. */
export function samplePolarOffset(p: PolarWarperState, hue: number, chroma: number): [number, number] {
  const x = (((((hue - ((p.angle ?? 0) * Math.PI) / 180) / (Math.PI * 2)) % 1) + 1) % 1) * p.spokes;
  const y = Math.max(0, Math.min(p.rings, (chroma / p.chromaLimit) * p.rings));
  const x0 = Math.floor(x),
    y0 = Math.min(p.rings - 1, Math.floor(y));
  const tx = smooth(x - x0),
    ty = smooth(y - y0);
  const node = (ring: number, spoke: number): [number, number] =>
    ring === 0 ? [0, 0] : p.offsets[(ring - 1) * p.spokes + (spoke % p.spokes)];
  const a = node(y0, x0),
    b = node(y0, x0 + 1),
    c = node(y0 + 1, x0),
    d = node(y0 + 1, x0 + 1);
  return [0, 1].map((k) => (a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (c[k] * (1 - tx) + d[k] * tx) * ty) as [
    number,
    number,
  ];
}

export function resamplePolarWarper(
  p: PolarWarperState,
  spokes: number,
  rings: number,
  chromaLimit = p.chromaLimit,
  angle = p.angle ?? 0,
): PolarWarperState {
  const next = createPolarWarper(spokes, rings, chromaLimit);
  next.angle = ((angle % 360) + 360) % 360;
  const oldHue = (p.angle ?? 0) + ((p.sliceSpoke ?? 0) / p.spokes) * 360;
  next.sliceSpoke = Math.round((((oldHue - next.angle + 360) % 360) / 360) * spokes) % spokes;
  next.offsets = next.offsets.map((_, i) => {
    const [h, c] = polarSource(next, i);
    const offset = samplePolarOffset(p, h, c);
    return [offset[0], Math.max(-c, Math.min(chromaLimit - c, offset[1]))];
  });
  next.lightness = Array.from({ length: spokes * rings * POLAR_LIGHTNESS_LEVELS }, (_, i) => {
    const [h, c] = polarSource(next, i % (spokes * rings));
    return samplePolarLightness(p, h, c, Math.floor(i / (spokes * rings)) / (POLAR_LIGHTNESS_LEVELS - 1));
  });
  next.sliceSpread = typeof p.sliceSpread === 'number' ? Math.min(p.sliceSpread, spokes / 2) : 'all';
  next.pinNeutrals = p.pinNeutrals ?? true;
  const neutral = p.neutral ?? [0, 0];
  const scale = Math.min(1, chromaLimit / (Math.hypot(...neutral) || 1));
  next.neutral = [neutral[0] * scale, neutral[1] * scale];
  next.neutralLightness = p.neutralLightness?.slice() ?? Array(7).fill(0);
  next.locks = Array(spokes * rings).fill(false);
  // Preserve every old pin at the nearest destination source node.
  for (let i = 0; i < p.offsets.length; i++) {
    const [h, c] = polarSource(p, i);
    const spoke: number = Math.round(((((h * 180) / Math.PI - next.angle! + 360) % 360) / 360) * spokes) % spokes;
    const ring = Math.max(0, Math.min(rings - 1, Math.round((c / chromaLimit) * rings) - 1));
    const target = ring * spokes + spoke;
    if (p.locks?.[i]) next.locks![target] = true;
    for (let layer = 0; layer < 7; layer++)
      if (p.lightnessLocks?.[layer * p.offsets.length + i])
        next.lightnessLocks![layer * next.offsets.length + target] = true;
  }
  return next;
}

/** Smooth source-space hue/chroma interpolation and linear lightness interpolation. */
export function samplePolarLightness(p: PolarWarperState, hue: number, chroma: number, lightness: number): number {
  const x = (((((hue - ((p.angle ?? 0) * Math.PI) / 180) / (Math.PI * 2)) % 1) + 1) % 1) * p.spokes;
  const y = Math.max(0, Math.min(p.rings, (chroma / p.chromaLimit) * p.rings));
  const z = Math.max(0, Math.min(1, lightness)) * (POLAR_LIGHTNESS_LEVELS - 1);
  const x0 = Math.floor(x),
    y0 = Math.min(p.rings - 1, Math.floor(y)),
    z0 = Math.min(POLAR_LIGHTNESS_LEVELS - 2, Math.floor(z));
  const tx = smooth(x - x0),
    ty = smooth(y - y0),
    tz = z - z0;
  const node = (layer: number, ring: number, spoke: number) =>
    ring === 0
      ? (p.neutralLightness?.[layer] ?? 0)
      : (p.lightness?.[layer * p.spokes * p.rings + (ring - 1) * p.spokes + (spoke % p.spokes)] ?? 0);
  const plane = (layer: number) =>
    (node(layer, y0, x0) * (1 - tx) + node(layer, y0, x0 + 1) * tx) * (1 - ty) +
    (node(layer, y0 + 1, x0) * (1 - tx) + node(layer, y0 + 1, x0 + 1) * tx) * ty;
  return plane(z0) * (1 - tz) + plane(z0 + 1) * tz;
}

export function setPolarLightness(p: PolarWarperState, index: number, value: number): PolarWarperState {
  const count = p.spokes * p.rings;
  const layer = Math.floor(index / count);
  if (layer <= 0 || layer >= POLAR_LIGHTNESS_LEVELS - 1) return p;
  const next = structuredClone(p);
  next.lightness ??= Array(count * POLAR_LIGHTNESS_LEVELS).fill(0);
  const source = layer / (POLAR_LIGHTNESS_LEVELS - 1);
  // Preserve tonal order at each source node, including the fixed black/white endpoints.
  const low = (layer - 1) / (POLAR_LIGHTNESS_LEVELS - 1) + next.lightness[index - count];
  const high = (layer + 1) / (POLAR_LIGHTNESS_LEVELS - 1) + next.lightness[index + count];
  next.lightness[index] = Math.max(low, Math.min(high, value)) - source;
  return next;
}

/** Hue/chroma shown at a position along an unfolded source spoke. */
export function polarSliceChroma(p: PolarWarperState, spoke: number, position: number): [number, number] {
  const [hue] = polarSource(p, spoke);
  const chroma = Math.max(0, Math.min(1, position)) * p.chromaLimit;
  const [dh, dc] = samplePolarOffset(p, hue, chroma);
  const c = Math.max(0, chroma + dc);
  const fade = 1 - smooth(Math.min(1, (chroma / p.chromaLimit) * p.rings));
  const a = c * Math.cos(hue + dh) + (p.neutral?.[0] ?? 0) * fade;
  const b = c * Math.sin(hue + dh) + (p.neutral?.[1] ?? 0) * fade;
  return [Math.atan2(b, a), Math.hypot(a, b)];
}

export function movePolarNode(p: PolarWarperState, index: number, hue: number, chroma: number): PolarWarperState {
  const [sourceH, sourceC] = polarSource(p, index);
  const next = structuredClone(p);
  next.offsets[index] = [wrapHueDelta(hue - sourceH), Math.max(0, Math.min(p.chromaLimit, chroma)) - sourceC];
  return next;
}
