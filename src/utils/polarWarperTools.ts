import { computeLinearGridInfluence } from './linearGridInfluence';
import { createPolarWarper, polarSource, wrapHueDelta, type PolarWarperState } from './polarColorWarper';

export const polarPoint = (p: PolarWarperState, index: number): [number, number] => {
  if (index === -1) return p.neutral ?? [0, 0];
  const [h, c] = polarSource(p, index),
    [dh, dc] = p.offsets[index];
  return [(c + dc) * Math.cos(h + dh), (c + dc) * Math.sin(h + dh)];
};

export function polarInfluence(p: PolarWarperState, selected: ReadonlySet<number>): Float32Array {
  const count = p.offsets.length;
  const result = new Float32Array(count + 1);
  for (const index of selected) {
    if (index < -1 || index >= count || (index === -1 && p.pinNeutrals !== false)) continue;
    const sourceRing = index === -1 ? 0 : Math.floor(index / p.spokes) + 1;
    const spokes = index === -1 ? Array.from({ length: p.spokes }, (_, i) => i) : [index % p.spokes];
    for (const spoke of spokes) {
      // Adjacent spokes are the angular boundaries. Color interpolation between
      // spokes supplies the falloff; moving those controls would widen the edit.
      let inner = 0,
        outer = p.rings;
      for (let ring = sourceRing - 1; ring > 0; ring--) {
        const i = (ring - 1) * p.spokes + spoke;
        if (p.locks?.[i] && !selected.has(i)) {
          inner = ring;
          break;
        }
      }
      for (let ring = sourceRing + 1; ring <= p.rings; ring++) {
        const i = (ring - 1) * p.spokes + spoke;
        if (p.locks?.[i] && !selected.has(i)) {
          outer = ring;
          break;
        }
      }
      for (let ring = 1; ring <= p.rings; ring++) {
        const i = (ring - 1) * p.spokes + spoke;
        if (p.locks?.[i] && !selected.has(i)) continue;
        const weight =
          ring === sourceRing
            ? 1
            : ring < sourceRing
              ? (ring - inner) / (sourceRing - inner)
              : (outer - ring) / (outer - sourceRing);
        result[i] = Math.max(result[i], Math.max(0, weight));
      }
    }
    if (index === -1) result[count] = 1;
  }
  return result;
}

function writePolarPoint(p: PolarWarperState, index: number, a: number, b: number) {
  const scale = Math.min(1, p.chromaLimit / (Math.hypot(a, b) || 1));
  a *= scale;
  b *= scale;
  if (index < 0) {
    p.neutral = [a, b];
    return;
  }
  const [h, c] = polarSource(p, index);
  p.offsets[index] = [
    Math.hypot(a, b) < 1e-8 ? p.offsets[index][0] : wrapHueDelta(Math.atan2(b, a) - h),
    Math.hypot(a, b) - c,
  ];
}

export function movePolarSelection(
  p: PolarWarperState,
  selected: ReadonlySet<number>,
  da: number,
  db: number,
  influence = polarInfluence(p, selected),
): PolarWarperState {
  const next = structuredClone(p);
  next.locks ??= createPolarWarper(p.spokes, p.rings).locks;
  for (let i = 0; i <= p.offsets.length; i++) {
    if (influence[i] <= 0) continue;
    const index = i === p.offsets.length ? -1 : i;
    const [a, b] = polarPoint(p, index);
    writePolarPoint(next, index, a + da * influence[i], b + db * influence[i]);
    if (index >= 0 && selected.has(index)) next.locks![index] = true;
  }
  return next;
}

/** Collapse halfway toward the selected centroid, propagating through the same pin-aware field. */
export function pullPolarTogether(p: PolarWarperState, selected: ReadonlySet<number>): PolarWarperState {
  const targets = [...selected].sort((a, b) => a - b).filter((i) => i >= 0 || p.pinNeutrals === false);
  if (targets.length < 2) return p;
  const points = targets.map((i) => polarPoint(p, i));
  const center = points.reduce(([a, b], [x, y]) => [a + x / points.length, b + y / points.length], [0, 0]);
  const fields = targets.map((i) => polarInfluence(p, new Set([i])));
  const next = structuredClone(p);
  next.locks ??= createPolarWarper(p.spokes, p.rings).locks;
  for (let i = 0; i <= p.offsets.length; i++) {
    const index = i === p.offsets.length ? -1 : i;
    if (index < 0 && p.pinNeutrals !== false) continue;
    const direct = targets.indexOf(index);
    let da = 0,
      db = 0,
      total = 0;
    if (direct >= 0) {
      da = (center[0] - points[direct][0]) * 0.5;
      db = (center[1] - points[direct][1]) * 0.5;
    } else {
      fields.forEach((f, k) => {
        da += (center[0] - points[k][0]) * 0.5 * f[i];
        db += (center[1] - points[k][1]) * 0.5 * f[i];
        total += f[i];
      });
      if (total > 1) {
        da /= total;
        db /= total;
      }
    }
    if (da === 0 && db === 0) continue;
    const [a, b] = polarPoint(p, index);
    writePolarPoint(next, index, a + da, b + db);
    if (index >= 0 && direct >= 0) next.locks![index] = true;
  }
  return next;
}

export const sliceLayer = (p: PolarWarperState, index: number) =>
  index < 0 ? -index - 1 : Math.floor(index / p.offsets.length);
export const sliceLightness = (p: PolarWarperState, index: number) =>
  sliceLayer(p, index) / 6 + (index < 0 ? (p.neutralLightness?.[-index - 1] ?? 0) : (p.lightness?.[index] ?? 0));

export function sliceInfluence(p: PolarWarperState, selected: ReadonlySet<number>): Float32Array {
  const count = p.offsets.length,
    result = new Float32Array(count * 7 + 7),
    width = p.rings + 1;
  for (const index of selected) {
    const layer = sliceLayer(p, index),
      selSpoke = index < 0 ? 0 : index % p.spokes;
    const ring = index < 0 ? 0 : Math.floor((index % count) / p.spokes) + 1;
    for (let spoke = 0; spoke < p.spokes; spoke++) {
      const distance = Math.min((spoke - selSpoke + p.spokes) % p.spokes, (selSpoke - spoke + p.spokes) % p.spokes);
      const reach = typeof p.sliceSpread === 'number' ? p.sliceSpread : p.spokes / 2;
      // A reach of 1 isolates this spoke; larger values taper symmetrically
      // across neighboring spokes, including across the circular seam.
      // The neutral spine is shared by all hues and cannot be split by spoke.
      const hueWeight = index < 0 ? 1 : Math.max(0, 1 - distance / reach);
      if (hueWeight === 0) continue;
      const locked = new Set<number>();
      for (let l = 0; l < 7; l++)
        for (let r = 0; r < width; r++) {
          const i = l * count + (r - 1) * p.spokes + spoke;
          if (l === 0 || l === 6 || (r === 0 ? p.pinNeutrals !== false : p.lightnessLocks?.[i] && !selected.has(i)))
            locked.add(l * width + r);
        }
      const field = computeLinearGridInfluence(width, new Set([layer * width + ring]), locked, 7);
      for (let l = 0; l < 7; l++)
        for (let r = 0; r < width; r++) {
          const i = r === 0 ? count * 7 + l : l * count + (r - 1) * p.spokes + spoke;
          result[i] = Math.max(result[i], field[l * width + r] * hueWeight);
        }
    }
  }
  for (let i = 0; i < result.length; i++) {
    const layer = i < count * 7 ? Math.floor(i / count) : i - count * 7;
    if (
      layer === 0 ||
      layer === 6 ||
      (i >= count * 7 && p.pinNeutrals !== false) ||
      (i < count * 7 && p.lightnessLocks?.[i] && !selected.has(i))
    )
      result[i] = 0;
  }
  return result;
}

export function moveSliceSelection(
  p: PolarWarperState,
  selected: ReadonlySet<number>,
  delta: number,
  field = sliceInfluence(p, selected),
): PolarWarperState {
  const next = structuredClone(p),
    count = p.offsets.length;
  next.lightness ??= Array(count * 7).fill(0);
  next.neutralLightness ??= Array(7).fill(0);
  next.lightnessLocks ??= Array(count * 7).fill(false);
  // One global step scale prevents tonal order reversals while keeping the interpolated shape.
  let scale = 1;
  for (let column = 0; column <= count; column++)
    for (let l = 0; l < 6; l++) {
      const a = column === count ? -(l + 1) : l * count + column,
        b = column === count ? -(l + 2) : (l + 1) * count + column;
      const ia = column === count ? count * 7 + l : a,
        ib = column === count ? count * 7 + l + 1 : b;
      const closing = delta * (field[ia] - field[ib]);
      if (closing > 0) scale = Math.min(scale, Math.max(0, (sliceLightness(p, b) - sliceLightness(p, a)) / closing));
    }
  for (let i = 0; i < field.length; i++) {
    if (i < count * 7) {
      next.lightness[i] += delta * field[i] * scale;
      if (selected.has(i) && field[i] !== 0) next.lightnessLocks[i] = true;
    } else next.neutralLightness[i - count * 7] += delta * field[i] * scale;
  }
  return next;
}

export function pullSliceTogether(p: PolarWarperState, selected: ReadonlySet<number>): PolarWarperState {
  if (selected.size < 2) return p;
  const targets = [...selected]
    .sort((a, b) => a - b)
    .filter((i) => sliceLayer(p, i) > 0 && sliceLayer(p, i) < 6 && (i >= 0 || p.pinNeutrals === false));
  if (targets.length < 2) return p;
  const mean = targets.reduce((sum, i) => sum + sliceLightness(p, i) / targets.length, 0);
  const fields = targets.map((i) => sliceInfluence(p, new Set([i])));
  const combined = new Float32Array(p.offsets.length * 7 + 7);
  for (let i = 0; i < combined.length; i++) {
    const index = i < p.offsets.length * 7 ? i : -(i - p.offsets.length * 7 + 1);
    if (targets.includes(index)) {
      combined[i] = (mean - sliceLightness(p, index)) * 0.5;
      continue;
    }
    let total = 0;
    fields.forEach((field, k) => {
      combined[i] += field[i] * (mean - sliceLightness(p, targets[k])) * 0.5;
      total += field[i];
    });
    if (total > 1) combined[i] /= total;
  }
  return moveSliceSelection(p, new Set(targets), 1, combined);
}
