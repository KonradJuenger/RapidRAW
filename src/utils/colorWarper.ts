export { computeLinearGridInfluence } from './linearGridInfluence';
import { createPolarWarper, normalizePolarWarper, type PolarWarperState } from './polarColorWarper';
export const COLOR_WARPER_SCHEMA_VERSION = 2 as const;
export const COLOR_WARPER_GRID_SIZES = [5, 7, 9, 13] as const;
export const COLOR_WARPER_MAX_GRID_SIZE = 13;
export const COLOR_WARPER_DEFAULT_CHROMA_LIMIT = 0.2;
export const COLOR_WARPER_CHROMA_LIMIT = COLOR_WARPER_DEFAULT_CHROMA_LIMIT;
export const COLOR_WARPER_CHROMA_LIMITS = [0.2, 0.3, 0.4] as const;

export type ColorWarperGridSize = (typeof COLOR_WARPER_GRID_SIZES)[number];
export type ColorWarperChromaLimit = (typeof COLOR_WARPER_CHROMA_LIMITS)[number];
export type ColorWarperPlaneIndex = 0 | 1;
export type ColorWarperOffset = [number, number];
export type ColorWarperNeutralOffset = [number, number, number];

export interface ColorWarperPlaneState {
  offsets: ColorWarperOffset[];
  locks: boolean[];
}

export interface ColorWarperNeutralAxisState {
  /** Plane A chroma, plane B chroma, shared lightness. */
  offsets: ColorWarperNeutralOffset[];
  locks: boolean[];
}

export interface ColorWarperState {
  mode?: 'grid' | 'polar' | 'linked';
  polar?: PolarWarperState;
  schemaVersion: 2;
  colorSpace: 'oklab';
  meshMode: 'cartesian-volume';
  interpolation: 'smooth-trilinear';
  solver: 'screened-laplacian';
  gamutMode: 'pipeline-native';
  axisAngle: number;
  gridSize: ColorWarperGridSize;
  chromaLimit?: number;
  planes: [ColorWarperPlaneState, ColorWarperPlaneState];
  neutralAxis: ColorWarperNeutralAxisState;
  /** Original payload retained when a newer/unknown state cannot be evaluated. */
  unsupportedState?: unknown;
}

export interface WarperCartesianColorSpace {
  id: ColorWarperState['colorSpace'];
  labels: { lightness: string; opponentA: string; opponentB: string };
  bounds: { lightness: [number, number]; opponent: [number, number] };
  xyzD65ToCoordinates(xyz: [number, number, number]): [number, number, number];
  coordinatesToXyzD65(value: [number, number, number]): [number, number, number];
}

export interface WorkingRgbSpace {
  id: 'rapidraw-display-srgb-d65-v1';
  workingRgbToXyzD65(rgb: [number, number, number]): [number, number, number];
  xyzD65ToWorkingRgb(xyz: [number, number, number]): [number, number, number];
  xyzD65ToLinearRgb(xyz: [number, number, number]): [number, number, number];
  linearRgbToWorkingRgb(linear: [number, number, number]): [number, number, number];
}

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const isCornerNode = (index: number, gridSize: number): boolean => {
  const col = index % gridSize;
  const row = Math.floor(index / gridSize);
  return (col === 0 || col === gridSize - 1) && (row === 0 || row === gridSize - 1);
};

const emptyPlane = (gridSize: number): ColorWarperPlaneState => ({
  offsets: Array.from({ length: gridSize * gridSize }, () => [0, 0] as ColorWarperOffset),
  locks: Array.from({ length: gridSize * gridSize }, (_, index) => isCornerNode(index, gridSize)),
});

export const createDefaultColorWarper = (
  gridSize: ColorWarperGridSize = 7,
  chromaLimit: number = COLOR_WARPER_DEFAULT_CHROMA_LIMIT,
): ColorWarperState => ({
  mode: 'linked',
  polar: createPolarWarper(),
  schemaVersion: COLOR_WARPER_SCHEMA_VERSION,
  colorSpace: 'oklab',
  meshMode: 'cartesian-volume',
  interpolation: 'smooth-trilinear',
  solver: 'screened-laplacian',
  gamutMode: 'pipeline-native',
  axisAngle: 0,
  gridSize,
  chromaLimit,
  planes: [emptyPlane(gridSize), emptyPlane(gridSize)],
  neutralAxis: {
    offsets: Array.from({ length: gridSize }, () => [0, 0, 0] as ColorWarperNeutralOffset),
    locks: Array.from({ length: gridSize }, () => true),
  },
});

export const normalizeColorWarper = (raw: unknown): ColorWarperState => {
  if (!raw || typeof raw !== 'object') return createDefaultColorWarper();
  const rawValue = raw as Record<string, unknown>;
  const value = raw as Partial<ColorWarperState> & Record<string, unknown>;
  const isLegacyPlaneState =
    rawValue.schemaVersion === 1 &&
    rawValue.colorSpace === 'oklab' &&
    rawValue.meshMode === 'chroma-luma-four-ray' &&
    rawValue.interpolation === 'smooth-bilinear' &&
    rawValue.solver === 'screened-laplacian' &&
    rawValue.gamutMode === 'pipeline-native';
  if (
    (!isLegacyPlaneState && value.schemaVersion !== COLOR_WARPER_SCHEMA_VERSION) ||
    value.colorSpace !== 'oklab' ||
    (!isLegacyPlaneState && value.meshMode !== 'cartesian-volume') ||
    (!isLegacyPlaneState && value.interpolation !== 'smooth-trilinear') ||
    value.solver !== 'screened-laplacian' ||
    value.gamutMode !== 'pipeline-native'
  ) {
    return { ...createDefaultColorWarper(), unsupportedState: raw };
  }

  const gridSize = value.gridSize === undefined ? 7 : value.gridSize;
  const chromaLimit = value.chromaLimit === undefined ? COLOR_WARPER_DEFAULT_CHROMA_LIMIT : value.chromaLimit;
  if (
    !COLOR_WARPER_GRID_SIZES.includes(gridSize) ||
    typeof chromaLimit !== 'number' ||
    !Number.isFinite(chromaLimit) ||
    chromaLimit < 0.1 ||
    chromaLimit > 1
  ) {
    return { ...createDefaultColorWarper(), unsupportedState: raw };
  }
  const isOffset = (entry: unknown, length: number): boolean =>
    Array.isArray(entry) &&
    entry.length === length &&
    entry.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
  const planesValid =
    Array.isArray(value.planes) &&
    value.planes.length === 2 &&
    value.planes.every(
      (plane) =>
        Array.isArray(plane?.offsets) &&
        plane.offsets.length === gridSize * gridSize &&
        plane.offsets.every((offset) => isOffset(offset, 2)) &&
        Array.isArray(plane.locks) &&
        plane.locks.length === gridSize * gridSize &&
        plane.locks.every((lock) => typeof lock === 'boolean'),
    );
  const neutralValid =
    Array.isArray(value.neutralAxis?.offsets) &&
    value.neutralAxis.offsets.length === gridSize &&
    value.neutralAxis.offsets.every((offset) => isOffset(offset, 3)) &&
    Array.isArray(value.neutralAxis.locks) &&
    value.neutralAxis.locks.length === gridSize &&
    value.neutralAxis.locks.every((lock) => typeof lock === 'boolean');
  if (!planesValid || !neutralValid || typeof value.axisAngle !== 'number' || !Number.isFinite(value.axisAngle)) {
    return { ...createDefaultColorWarper(), unsupportedState: raw };
  }
  const validatedPlanes = value.planes as ColorWarperState['planes'];
  const validatedNeutral = value.neutralAxis as ColorWarperNeutralAxisState;
  const center = Math.floor(gridSize / 2);
  const deformationInBounds = validatedPlanes.every((plane) =>
    plane.offsets.every((offset, index) => {
      if (index % gridSize === center) return true;
      const sourceC = (((index % gridSize) / (gridSize - 1)) * 2 - 1) * chromaLimit;
      const sourceL = 1 - Math.floor(index / gridSize) / (gridSize - 1);
      return (
        sourceC + offset[0] >= -chromaLimit - 1e-8 &&
        sourceC + offset[0] <= chromaLimit + 1e-8 &&
        sourceL + offset[1] >= -1e-8 &&
        sourceL + offset[1] <= 1 + 1e-8
      );
    }),
  );
  const neutralInBounds = validatedNeutral.offsets.every((offset, row) => {
    const sourceL = 1 - row / (gridSize - 1);
    return (
      Math.abs(offset[0]) <= chromaLimit + 1e-8 &&
      Math.abs(offset[1]) <= chromaLimit + 1e-8 &&
      sourceL + offset[2] >= -1e-8 &&
      sourceL + offset[2] <= 1 + 1e-8
    );
  });
  if (!deformationInBounds || !neutralInBounds) {
    return { ...createDefaultColorWarper(), unsupportedState: raw };
  }
  const polar = normalizePolarWarper(value.polar);
  if (
    (value.mode !== undefined && value.mode !== 'grid' && value.mode !== 'polar' && value.mode !== 'linked') ||
    !polar
  ) {
    return { ...createDefaultColorWarper(), unsupportedState: raw };
  }
  const normalized = createDefaultColorWarper(gridSize, chromaLimit);
  normalized.mode = value.mode ?? 'grid';
  normalized.polar = polar;
  if (value.unsupportedState !== undefined) normalized.unsupportedState = value.unsupportedState;
  normalized.axisAngle = ((finite(value.axisAngle) % 360) + 360) % 360;

  const rawPlanes = Array.isArray(value.planes) ? value.planes : [];
  for (let plane = 0; plane < 2; plane += 1) {
    const source = rawPlanes[plane] as Partial<ColorWarperPlaneState> | undefined;
    for (let index = 0; index < gridSize * gridSize; index += 1) {
      const column = index % gridSize;
      if (column === center) continue;
      const candidate = Array.isArray(source?.offsets?.[index]) ? source?.offsets?.[index] : undefined;
      normalized.planes[plane as ColorWarperPlaneIndex].offsets[index] = [
        finite(candidate?.[0]),
        finite(candidate?.[1]),
      ];
      normalized.planes[plane as ColorWarperPlaneIndex].locks[index] = source?.locks?.[index] === true;
    }
  }

  const neutral = value.neutralAxis as Partial<ColorWarperNeutralAxisState> | undefined;
  for (let row = 0; row < gridSize; row += 1) {
    const candidate = Array.isArray(neutral?.offsets?.[row]) ? neutral?.offsets?.[row] : undefined;
    normalized.neutralAxis.offsets[row] = [finite(candidate?.[0]), finite(candidate?.[1]), finite(candidate?.[2])];
    normalized.neutralAxis.locks[row] = neutral?.locks?.[row] === true;
  }
  return normalized;
};

export const cloneColorWarper = (state: ColorWarperState): ColorWarperState => ({
  ...state,
  polar: structuredClone(state.polar ?? createPolarWarper()),
  chromaLimit: state.chromaLimit ?? COLOR_WARPER_DEFAULT_CHROMA_LIMIT,
  planes: state.planes.map((plane) => ({
    offsets: plane.offsets.map(([x, y]) => [x, y] as ColorWarperOffset),
    locks: [...plane.locks],
  })) as [ColorWarperPlaneState, ColorWarperPlaneState],
  neutralAxis: {
    offsets: state.neutralAxis.offsets.map(([a, b, l]) => [a, b, l] as ColorWarperNeutralOffset),
    locks: [...state.neutralAxis.locks],
  },
});

export const isColorWarperIdentity = (state: ColorWarperState): boolean =>
  state.mode === 'polar' || state.mode === 'linked'
    ? (state.polar?.offsets.every(([h, c]) => h === 0 && c === 0) ?? true) &&
      (state.polar?.neutral?.every((v) => v === 0) ?? true) &&
      (state.mode !== 'linked' ||
        ((state.polar?.lightness?.every((l) => l === 0) ?? true) &&
          (state.polar?.neutralLightness?.every((v) => v === 0) ?? true)))
    : state.planes.every((plane) => plane.offsets.every(([x, y]) => x === 0 && y === 0)) &&
      state.neutralAxis.offsets.every(([a, b, l]) => a === 0 && b === 0 && l === 0);

export const getPlaneNode = (
  state: ColorWarperState,
  plane: ColorWarperPlaneIndex,
  index: number,
): { offset: ColorWarperOffset; locked: boolean } => {
  const column = index % state.gridSize;
  const row = Math.floor(index / state.gridSize);
  if (column === Math.floor(state.gridSize / 2)) {
    const neutral = state.neutralAxis.offsets[row];
    return { offset: [neutral[plane], neutral[2]], locked: state.neutralAxis.locks[row] };
  }
  return { offset: state.planes[plane].offsets[index], locked: state.planes[plane].locks[index] };
};

export const setPlaneNode = (
  state: ColorWarperState,
  plane: ColorWarperPlaneIndex,
  index: number,
  offset: ColorWarperOffset,
  locked?: boolean,
): void => {
  const column = index % state.gridSize;
  const row = Math.floor(index / state.gridSize);
  if (column === Math.floor(state.gridSize / 2)) {
    state.neutralAxis.offsets[row][plane] = finite(offset[0]);
    state.neutralAxis.offsets[row][2] = finite(offset[1]);
    if (locked !== undefined) state.neutralAxis.locks[row] = locked;
    return;
  }
  state.planes[plane].offsets[index] = [finite(offset[0]), finite(offset[1])];
  if (locked !== undefined) state.planes[plane].locks[index] = locked;
};

const smooth = (value: number): number => value * value * (3 - 2 * value);

export const samplePlaneOffset = (
  state: ColorWarperState,
  plane: ColorWarperPlaneIndex,
  signedChroma: number,
  lightness: number,
): ColorWarperOffset => {
  const size = state.gridSize;
  const chromaLimit = state.chromaLimit ?? COLOR_WARPER_DEFAULT_CHROMA_LIMIT;
  const gx = Math.min(size - 1, Math.max(0, (signedChroma / chromaLimit + 1) * 0.5 * (size - 1)));
  const gy = Math.min(size - 1, Math.max(0, (1 - lightness) * (size - 1)));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const at = (x: number, y: number) => getPlaneNode(state, plane, y * size + x).offset;
  const p00 = at(x0, y0);
  const p10 = at(x1, y0);
  const p01 = at(x0, y1);
  const p11 = at(x1, y1);
  const top: ColorWarperOffset = [p00[0] * (1 - tx) + p10[0] * tx, p00[1] * (1 - tx) + p10[1] * tx];
  const bottom: ColorWarperOffset = [p01[0] * (1 - tx) + p11[0] * tx, p01[1] * (1 - tx) + p11[1] * tx];
  return [top[0] * (1 - ty) + bottom[0] * ty, top[1] * (1 - ty) + bottom[1] * ty];
};

export const computeScreenedInfluence = (
  gridSize: number,
  selected: ReadonlySet<number>,
  locked: ReadonlySet<number>,
  screening = 0,
): Float32Array => {
  const count = gridSize * gridSize;
  const values = new Float32Array(count);
  for (const index of selected) if (!locked.has(index) && index >= 0 && index < count) values[index] = 1;

  for (let iteration = 0; iteration < 96; iteration += 1) {
    let largestChange = 0;
    for (let index = 0; index < count; index += 1) {
      if (selected.has(index) && !locked.has(index)) continue;
      if (locked.has(index)) {
        values[index] = 0;
        continue;
      }
      const x = index % gridSize;
      const y = Math.floor(index / gridSize);
      let sum = 0;
      let degree = 0;
      if (x > 0) {
        sum += values[index - 1];
        degree += 1;
      }
      if (x + 1 < gridSize) {
        sum += values[index + 1];
        degree += 1;
      }
      if (y > 0) {
        sum += values[index - gridSize];
        degree += 1;
      }
      if (y + 1 < gridSize) {
        sum += values[index + gridSize];
        degree += 1;
      }
      const next = degree + screening > 0 ? sum / (degree + screening) : 0;
      largestChange = Math.max(largestChange, Math.abs(next - values[index]));
      values[index] = next;
    }
    if (largestChange < 0.00001) break;
  }
  return values;
};

export const computeJoinedLightnessInfluence = (
  gridSize: number,
  selectedByPlane: [ReadonlySet<number>, ReadonlySet<number>],
  lockedByPlane: [ReadonlySet<number>, ReadonlySet<number>],
  screening = 0,
): [Float32Array, Float32Array] => {
  const center = Math.floor(gridSize / 2);
  const planeStride = gridSize * (gridSize - 1);
  const logicalIndex = (plane: ColorWarperPlaneIndex, index: number): number => {
    const row = Math.floor(index / gridSize);
    const column = index % gridSize;
    if (column === center) return row;
    const compactColumn = column < center ? column : column - 1;
    return gridSize + plane * planeStride + row * (gridSize - 1) + compactColumn;
  };
  const count = gridSize + 2 * planeStride;
  const neighbours = Array.from({ length: count }, () => new Set<number>());
  const selected = new Set<number>();
  const locked = new Set<number>();

  for (const plane of [0, 1] as ColorWarperPlaneIndex[]) {
    for (let index = 0; index < gridSize * gridSize; index += 1) {
      const logical = logicalIndex(plane, index);
      if (selectedByPlane[plane].has(index)) selected.add(logical);
      if (lockedByPlane[plane].has(index)) locked.add(logical);
      const column = index % gridSize;
      const row = Math.floor(index / gridSize);
      const adjacent: number[] = [];
      if (column > 0) adjacent.push(index - 1);
      if (column + 1 < gridSize) adjacent.push(index + 1);
      if (row > 0) adjacent.push(index - gridSize);
      if (row + 1 < gridSize) adjacent.push(index + gridSize);
      adjacent.forEach((other) => {
        const otherLogical = logicalIndex(plane, other);
        if (otherLogical !== logical) {
          neighbours[logical].add(otherLogical);
          neighbours[otherLogical].add(logical);
        }
      });
    }
  }

  const values = new Float32Array(count);
  selected.forEach((index) => {
    if (!locked.has(index)) values[index] = 1;
  });
  for (let iteration = 0; iteration < 96; iteration += 1) {
    let largestChange = 0;
    for (let index = 0; index < count; index += 1) {
      if (selected.has(index) && !locked.has(index)) continue;
      if (locked.has(index)) {
        values[index] = 0;
        continue;
      }
      let sum = 0;
      neighbours[index].forEach((other) => {
        sum += values[other];
      });
      const next = neighbours[index].size + screening > 0 ? sum / (neighbours[index].size + screening) : 0;
      largestChange = Math.max(largestChange, Math.abs(next - values[index]));
      values[index] = next;
    }
    if (largestChange < 0.00001) break;
  }

  return ([0, 1] as ColorWarperPlaneIndex[]).map((plane) => {
    const expanded = new Float32Array(gridSize * gridSize);
    for (let index = 0; index < expanded.length; index += 1) {
      expanded[index] = values[logicalIndex(plane, index)];
    }
    return expanded;
  }) as [Float32Array, Float32Array];
};

export const resampleColorWarper = (
  state: ColorWarperState,
  gridSize: ColorWarperGridSize,
  targetChromaLimit?: number,
): ColorWarperState => {
  const currentChromaLimit = state.chromaLimit ?? COLOR_WARPER_DEFAULT_CHROMA_LIMIT;
  const nextChromaLimit = targetChromaLimit ?? currentChromaLimit;
  if (state.gridSize === gridSize && currentChromaLimit === nextChromaLimit) return cloneColorWarper(state);
  const result = createDefaultColorWarper(gridSize, nextChromaLimit);
  if (state.unsupportedState !== undefined) result.unsupportedState = state.unsupportedState;
  result.axisAngle = state.axisAngle;
  result.mode = state.mode;
  result.polar = structuredClone(state.polar ?? createPolarWarper());
  for (let plane = 0; plane < 2; plane += 1) {
    for (let index = 0; index < gridSize * gridSize; index += 1) {
      const x = index % gridSize;
      const y = Math.floor(index / gridSize);
      const signedChroma = ((x / (gridSize - 1)) * 2 - 1) * nextChromaLimit;
      const lightness = 1 - y / (gridSize - 1);
      const offset = samplePlaneOffset(state, plane as ColorWarperPlaneIndex, signedChroma, lightness);
      const clampedOffset: ColorWarperOffset = [
        Math.max(-nextChromaLimit - signedChroma, Math.min(nextChromaLimit - signedChroma, offset[0])),
        Math.max(-lightness, Math.min(1 - lightness, offset[1])),
      ];
      setPlaneNode(result, plane as ColorWarperPlaneIndex, index, clampedOffset);
    }
  }

  // Map every persistent lock to its coincident or nearest destination node.
  // Iterating old locks (instead of sampling locks from the new grid) guarantees
  // that isolated locks survive both upsampling and downsampling; collisions OR.
  const oldCenter = Math.floor(state.gridSize / 2);
  const newCenter = Math.floor(gridSize / 2);
  for (let plane = 0; plane < 2; plane += 1) {
    for (let oldIndex = 0; oldIndex < state.gridSize * state.gridSize; oldIndex += 1) {
      if (!getPlaneNode(state, plane as ColorWarperPlaneIndex, oldIndex).locked) continue;
      const oldX = oldIndex % state.gridSize;
      const oldY = Math.floor(oldIndex / state.gridSize);
      const newX = oldX === oldCenter ? newCenter : Math.round((oldX / (state.gridSize - 1)) * (gridSize - 1));
      const newY = Math.round((oldY / (state.gridSize - 1)) * (gridSize - 1));
      const newIndex = newY * gridSize + newX;
      const current = getPlaneNode(result, plane as ColorWarperPlaneIndex, newIndex);
      setPlaneNode(result, plane as ColorWarperPlaneIndex, newIndex, current.offset, true);
    }
  }

  // Ensure default pins (corners and middle column) are preserved on the target grid
  for (let row = 0; row < gridSize; row += 1) {
    result.neutralAxis.locks[row] = true;
  }
  for (let plane = 0; plane < 2; plane += 1) {
    for (const corner of [0, gridSize - 1, (gridSize - 1) * gridSize, gridSize * gridSize - 1]) {
      result.planes[plane as ColorWarperPlaneIndex].locks[corner] = true;
    }
  }

  return result;
};

export const resampleColorWarperChromaLimit = (state: ColorWarperState, chromaLimit: number): ColorWarperState =>
  resampleColorWarper(state, state.gridSize, chromaLimit);

const srgbToLinearChannel = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.04045 ? magnitude / 12.92 : Math.pow((magnitude + 0.055) / 1.055, 2.4));
};

const linearToSrgbChannel = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * Math.pow(magnitude, 1 / 2.4) - 0.055);
};

export const OKLAB_COLOR_SPACE: WarperCartesianColorSpace = {
  id: 'oklab',
  labels: { lightness: 'L', opponentA: 'a', opponentB: 'b' },
  bounds: { lightness: [0, 1], opponent: [-COLOR_WARPER_CHROMA_LIMIT, COLOR_WARPER_CHROMA_LIMIT] },
  xyzD65ToCoordinates: ([x, y, z]) => {
    const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
    const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  },
  coordinatesToXyzD65: ([L, a, b]) => {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return [
      0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
      0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb,
      0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb,
    ];
  },
};

export const RAPIDRAW_DISPLAY_SRGB_D65: WorkingRgbSpace = {
  id: 'rapidraw-display-srgb-d65-v1',
  workingRgbToXyzD65: ([r, g, b]) => {
    const lr = srgbToLinearChannel(r);
    const lg = srgbToLinearChannel(g);
    const lb = srgbToLinearChannel(b);
    return [
      0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
      0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb,
      0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb,
    ];
  },
  xyzD65ToLinearRgb: ([x, y, z]) => [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ],
  linearRgbToWorkingRgb: ([r, g, b]) => [linearToSrgbChannel(r), linearToSrgbChannel(g), linearToSrgbChannel(b)],
  xyzD65ToWorkingRgb: ([x, y, z]) => [
    linearToSrgbChannel(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    linearToSrgbChannel(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    linearToSrgbChannel(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ],
};

export const workingRgbToWarperCoordinates = (
  working: WorkingRgbSpace,
  colorSpace: WarperCartesianColorSpace,
  rgb: [number, number, number],
): [number, number, number] => colorSpace.xyzD65ToCoordinates(working.workingRgbToXyzD65(rgb));

export const warperCoordinatesToWorkingRgb = (
  working: WorkingRgbSpace,
  colorSpace: WarperCartesianColorSpace,
  coordinates: [number, number, number],
): [number, number, number] => working.xyzD65ToWorkingRgb(colorSpace.coordinatesToXyzD65(coordinates));

/**
 * Converts warper coordinates to working RGB with constant-lightness, constant-hue
 * gamut boundary projection. If the coordinate falls outside the working display gamut
 * (e.g. low-lightness yellow), it clamps chroma along the hue ray to the display gamut boundary
 * rather than clipping channels naively, preventing hue flips (like green in dark yellow).
 */
export const warperCoordinatesToGamutMappedWorkingRgb = (
  working: WorkingRgbSpace,
  colorSpace: WarperCartesianColorSpace,
  [lightness, chromaA, chromaB]: [number, number, number],
): { rgb: [number, number, number]; inGamut: boolean } => {
  const directXyz = colorSpace.coordinatesToXyzD65([lightness, chromaA, chromaB]);
  let linear = working.xyzD65ToLinearRgb(directXyz);
  const isInGamut =
    linear[0] >= -1e-6 &&
    linear[0] <= 1 + 1e-6 &&
    linear[1] >= -1e-6 &&
    linear[1] <= 1 + 1e-6 &&
    linear[2] >= -1e-6 &&
    linear[2] <= 1 + 1e-6;

  if (isInGamut) {
    return {
      rgb: working.linearRgbToWorkingRgb(linear),
      inGamut: true,
    };
  }

  const clampedL = Math.max(0, Math.min(1, lightness));
  const neutralXyz = colorSpace.coordinatesToXyzD65([clampedL, 0, 0]);
  const neutralLinear = working.xyzD65ToLinearRgb(neutralXyz);

  const chromaMagnitudeSq = chromaA * chromaA + chromaB * chromaB;
  if (chromaMagnitudeSq < 1e-12) {
    return {
      rgb: working.linearRgbToWorkingRgb(neutralLinear),
      inGamut: false,
    };
  }

  // Initialize to neutral at this lightness so unachievable corners fall back to neutral
  linear = neutralLinear;

  // Binary search along the constant-lightness, constant-hue chroma ray: (L, t * cA, t * cB)
  let low = 0;
  let high = 1;
  for (let iter = 0; iter < 8; iter += 1) {
    const mid = (low + high) * 0.5;
    const testXyz = colorSpace.coordinatesToXyzD65([lightness, chromaA * mid, chromaB * mid]);
    const testLinear = working.xyzD65ToLinearRgb(testXyz);
    if (
      testLinear[0] >= -1e-6 &&
      testLinear[0] <= 1 + 1e-6 &&
      testLinear[1] >= -1e-6 &&
      testLinear[1] <= 1 + 1e-6 &&
      testLinear[2] >= -1e-6 &&
      testLinear[2] <= 1 + 1e-6
    ) {
      low = mid;
      linear = testLinear;
    } else {
      high = mid;
    }
  }

  return {
    rgb: working.linearRgbToWorkingRgb(linear),
    inGamut: false,
  };
};

export const WARPER_COLOR_SPACES: Record<ColorWarperState['colorSpace'], WarperCartesianColorSpace> = {
  oklab: OKLAB_COLOR_SPACE,
};
