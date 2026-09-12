import { describe, expect, it } from 'vitest';
import {
  cloneColorWarper,
  createDefaultColorWarper,
  isColorWarperIdentity,
  normalizeColorWarper,
  resampleColorWarper,
} from './colorWarper';
import {
  createPolarWarper,
  normalizePolarWarper,
  polarSource,
  resamplePolarWarper,
  samplePolarOffset,
  polarSliceChroma,
  movePolarNode,
  samplePolarLightness,
  setPolarLightness,
} from './polarColorWarper';

describe('polar color warper', () => {
  it('preserves neutral colors and interpolates continuously across the hue seam', () => {
    const p = createPolarWarper();
    p.offsets[0] = [0.3, 0.02];
    expect(samplePolarOffset(p, 0, 0)).toEqual([0, 0]);
    expect(samplePolarOffset(p, 0, p.chromaLimit / p.rings)).toEqual([0.3, 0.02]);
    const left = samplePolarOffset(p, -1e-7, 0.05);
    const right = samplePolarOffset(p, 1e-7, 0.05);
    expect(left[0]).toBeCloseTo(right[0], 10);
    expect(left[1]).toBeCloseTo(right[1], 10);
  });

  it('resamples spokes and rings while retaining coincident controls', () => {
    const p = createPolarWarper();
    p.offsets[8] = [-0.2, 0.03];
    const next = resamplePolarWarper(p, 12, 12);
    const [h, c] = polarSource(p, 8);
    expect(samplePolarOffset(next, h, c)[0]).toBeCloseTo(-0.2);
    expect(samplePolarOffset(next, h, c)[1]).toBeCloseTo(0.03);
    expect(normalizePolarWarper(next)).not.toBeNull();
  });

  it('retains independent mode edits through persistence, cloning and grid resizing', () => {
    const state = createDefaultColorWarper();
    state.mode = 'polar';
    state.polar!.offsets[0] = [0.1, 0.01];
    state.planes[0].offsets[8] = [0.01, 0];
    expect(normalizeColorWarper(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(resampleColorWarper(state, 9).polar).toEqual(state.polar);
    const copy = cloneColorWarper(state);
    copy.polar!.offsets[0][0] = 0;
    expect(state.polar!.offsets[0][0]).toBe(0.1);
    expect(isColorWarperIdentity(state)).toBe(false);
    state.polar = createPolarWarper();
    expect(isColorWarperIdentity(state)).toBe(true);
    state.mode = 'grid';
    expect(isColorWarperIdentity(state)).toBe(false);
  });

  it('defaults old edits to grid and preserves malformed polar payloads as unsupported', () => {
    const state = createDefaultColorWarper();
    delete state.mode;
    delete state.polar;
    expect(normalizeColorWarper(state).mode).toBe('grid');
    for (const change of [{ spokes: 0 }, { rings: 999 }, { offsets: [] }, { chromaLimit: NaN }]) {
      const invalid = { ...state, mode: 'polar', polar: { ...createPolarWarper(), ...change } };
      expect(normalizeColorWarper(invalid).unsupportedState).toEqual(invalid);
    }
  });
});

describe('linked lightness slice', () => {
  it('edits only lightness and keeps source membership after bending the wheel', () => {
    const initial = createPolarWarper();
    initial.offsets[0] = [0.4, 0.02];
    const p = setPolarLightness(initial, 3 * 36, 0.6);
    expect(p.offsets).toEqual(initial.offsets);
    expect(samplePolarLightness(p, 0, 0.05, 0.5)).toBeCloseTo(0.1);
    expect(samplePolarLightness(p, 0, 0, 0.5)).toBe(0);
    expect(samplePolarLightness(p, 0, 0.05, 0)).toBe(0);
    expect(samplePolarLightness(p, 0, 0.05, 1)).toBe(0);
    expect(samplePolarLightness(p, -1e-7, 0.05, 0.5)).toBeCloseTo(samplePolarLightness(p, 1e-7, 0.05, 0.5), 10);
    const resized = resamplePolarWarper(p, 12, 12);
    expect(samplePolarLightness(resized, 0, 0.05, 0.5)).toBeCloseTo(0.1);
  });
  it('preserves tonal order and endpoints', () => {
    const p = setPolarLightness(createPolarWarper(), 3 * 36, 2);
    expect(0.5 + p.lightness![3 * 36]).toBeCloseTo(4 / 6);
    expect(setPolarLightness(p, 0, 0.2)).toBe(p);
    expect(setPolarLightness(p, 6 * 36, 0.8)).toBe(p);
  });
  it('persists linked edits and bypasses them in polar-only mode', () => {
    const state = createDefaultColorWarper();
    state.mode = 'linked';
    state.polar = setPolarLightness(state.polar!, 3 * 36, 0.6);
    expect(normalizeColorWarper(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(isColorWarperIdentity(state)).toBe(false);
    state.mode = 'polar';
    expect(isColorWarperIdentity(state)).toBe(true);
    const old = createPolarWarper();
    delete old.lightness;
    expect(normalizePolarWarper(old)?.lightness).toHaveLength(252);
    expect(normalizePolarWarper({ ...old, lightness: [0.1] })).toBeNull();
  });
});

describe('polar alignment and precision', () => {
  it('rotates an identity mesh without recoloring and wraps angles', () => {
    const p = resamplePolarWarper(createPolarWarper(), 6, 6, 0.3, -30);
    expect(p.angle).toBe(330);
    expect(p.offsets.every(([h, c]) => h === 0 && c === 0)).toBe(true);
    expect(normalizePolarWarper(p)).toEqual(p);
    expect(polarSource(p, 0)[0]).toBeCloseTo((330 * Math.PI) / 180);
    expect(normalizePolarWarper({ ...p, angle: Infinity })).toBeNull();
  });
  it('reindexes hue and lightness edits when aligned by a whole spoke', () => {
    const p = setPolarLightness(createPolarWarper(), 3 * 36, 0.6);
    p.offsets[0] = [0.3, 0.01];
    const next = resamplePolarWarper(p, 6, 6, 0.3, 60);
    for (const hue of [-0.1, 0, 0.1, 1.3, 5.9]) {
      expect(samplePolarOffset(next, hue, 0.05)[0]).toBeCloseTo(samplePolarOffset(p, hue, 0.05)[0], 8);
      expect(samplePolarLightness(next, hue, 0.05, 0.5)).toBeCloseTo(samplePolarLightness(p, hue, 0.05, 0.5), 8);
    }
    expect(next.sliceSpoke).toBe(5);
  });
  it('samples smoothly across ring boundaries and reaches exact deformed nodes', () => {
    const p = createPolarWarper();
    p.offsets[6] = [1.2, -0.02];
    const a = polarSliceChroma(p, 0, 2 / 6 - 1e-6),
      b = polarSliceChroma(p, 0, 2 / 6 + 1e-6);
    expect(a[0]).toBeCloseTo(b[0], 7);
    expect(a[1]).toBeCloseTo(b[1], 5);
    expect(polarSliceChroma(p, 0, 2 / 6)[0]).toBeCloseTo(1.2);
    expect(polarSliceChroma(p, 0, 2 / 6)[1]).toBeCloseTo(0.08);
  });
  it('moves hue and chroma freely without changing lightness', () => {
    const p = createPolarWarper();
    const next = movePolarNode(p, 0, 0.5, 0.2);
    expect(next.offsets[0][0]).toBeCloseTo(0.5);
    expect(next.offsets[0][1]).toBeCloseTo(0.15);
    expect(next.lightness).toEqual(p.lightness);
  });
});
