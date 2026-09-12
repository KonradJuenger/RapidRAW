import { describe, expect, it } from 'vitest';
import {
  createPolarWarper,
  normalizePolarWarper,
  resamplePolarWarper,
  samplePolarLightness,
  polarSliceChroma,
} from './polarColorWarper';
import {
  polarInfluence,
  movePolarSelection,
  polarPoint,
  pullPolarTogether,
  moveSliceSelection,
  pullSliceTogether,
  sliceLightness,
} from './polarWarperTools';
describe('polar editing tools', () => {
  it('isolates lightness edits to the selected spoke at reach 1', () => {
    const p = createPolarWarper();
    p.sliceSpread = 1;
    const index = 3 * p.offsets.length + 12;
    const next = moveSliceSelection(p, new Set([index]), 0.05);
    expect(next.lightness![index]).toBeCloseTo(0.05);
    for (let i = 0; i < next.lightness!.length; i++) if (i % p.spokes !== 0) expect(next.lightness![i]).toBe(0);
    expect(next.offsets).toEqual(p.offsets);
  });
  it('limits symmetric spread and wraps across the first/last spoke', () => {
    const p = createPolarWarper(12, 6);
    p.sliceSpread = 2;
    const index = 3 * p.offsets.length + 24;
    const next = moveSliceSelection(p, new Set([index]), 0.05);
    expect(next.lightness![index + 1]).toBeCloseTo(0.025);
    expect(next.lightness![index + 11]).toBeCloseTo(0.025);
    for (let spoke = 2; spoke < 11; spoke++) expect(next.lightness![index + spoke]).toBe(0);
    p.sliceSpread = 3;
    const wider = moveSliceSelection(p, new Set([index]), 0.05);
    expect(wider.lightness![index + 2]).toBeGreaterThan(0);
    expect(wider.lightness![index + 10]).toBeGreaterThan(0);
    expect(wider.lightness![index + 3]).toBe(0);
  });
  it('applies the spread limit to pull-together edits as well', () => {
    const p = createPolarWarper();
    p.sliceSpread = 1;
    const next = pullSliceTogether(p, new Set([2 * 36 + 12, 4 * 36 + 12]));
    expect(next.lightness![2 * 36 + 12]).not.toBe(0);
    for (let i = 0; i < next.lightness!.length; i++) if (i % 6 !== 0) expect(next.lightness![i]).toBe(0);
  });
  it('persists lightness spread, defaults old edits to All, and clamps on resizing', () => {
    const p = createPolarWarper(12, 6);
    p.sliceSpread = 5;
    expect(normalizePolarWarper(JSON.parse(JSON.stringify(p)))?.sliceSpread).toBe(5);
    expect(resamplePolarWarper(p, 6, 6).sliceSpread).toBe(3);
    delete p.sliceSpread;
    expect(normalizePolarWarper(p)?.sliceSpread).toBe('all');
    for (const value of [0, -1, 1.5, 7, NaN]) {
      p.sliceSpread = value;
      expect(normalizePolarWarper(p)).toBeNull();
    }
  });
  it('bounds influence by the next spokes and center/edge at every grid resolution', () => {
    for (const spokes of [6, 12, 24]) {
      const p = createPolarWarper(spokes, 6);
      for (const spoke of [0, spokes - 1]) {
        const f = polarInfluence(p, new Set([2 * spokes + spoke]));
        for (let i = 0; i < p.offsets.length; i++) {
          const ring = Math.floor(i / spokes) + 1;
          const expected = i % spokes === spoke ? Math.max(0, 1 - Math.abs(ring - 3) / 3) : 0;
          expect(f[i]).toBeCloseTo(expected);
        }
        expect(f[p.offsets.length]).toBe(0);
      }
    }
  });
  it('stops radial movement at the nearest pin and supports direct edge edits', () => {
    const p = createPolarWarper();
    p.locks![24] = true;
    const f = polarInfluence(p, new Set([12]));
    expect(f[18]).toBeCloseTo(0.5);
    expect(f[24]).toBe(0);
    expect(f[30]).toBe(0);
    const edge = polarInfluence(p, new Set([30]));
    expect(edge[30]).toBe(1);
    expect(edge[24]).toBe(0);
    expect(edge[18]).toBe(0);
  });
  it('propagates radially while adjacent spokes and pins remain fixed', () => {
    const p = createPolarWarper();
    p.locks![13] = true;
    const next = movePolarSelection(p, new Set([12]), 0.01, 0.005);
    expect(polarPoint(next, 12)[0] - polarPoint(p, 12)[0]).toBeCloseTo(0.01);
    expect(next.offsets[13]).toEqual(p.offsets[13]);
    expect(next.offsets[17]).toEqual(p.offsets[17]);
    expect(next.offsets[6]).not.toEqual(p.offsets[6]);
    expect(next.offsets[18]).not.toEqual(p.offsets[18]);
    expect(next.offsets[30]).toEqual(p.offsets[30]);
    expect(next.neutral).toEqual([0, 0]);
    expect(next.locks![12]).toBe(true);
  });
  it('keeps neutrals pinned by default and supports shared neutral edits when unpinned', () => {
    let p = createPolarWarper();
    expect(movePolarSelection(p, new Set([-1]), 0.02, 0).neutral).toEqual([0, 0]);
    p.pinNeutrals = false;
    p = movePolarSelection(p, new Set([-1]), 0.02, 0);
    expect(p.neutral![0]).toBeCloseTo(0.02);
    expect(polarSliceChroma(p, 0, 0)[1]).toBeCloseTo(0.02);
    p = moveSliceSelection(p, new Set([-4]), 0.05);
    expect(samplePolarLightness(p, 1, 0, 0.5)).toBeCloseTo(0.05);
    expect(normalizePolarWarper(p)).not.toBeNull();
  });
  it('pulls selected wheel points halfway together without disturbing a pinned neighbor', () => {
    const p = createPolarWarper();
    p.locks![13] = true;
    const selection = new Set([12, 14]),
      next = pullPolarTogether(p, selection);
    const distance = (q: typeof p) => Math.hypot(...polarPoint(q, 12).map((v, k) => v - polarPoint(q, 14)[k]));
    expect(distance(next)).toBeCloseTo(distance(p) / 2);
    expect(next.offsets[13][0]).toBeCloseTo(0);
    expect(next.offsets[13][1]).toBeCloseTo(0);
  });
  it('holds slice pins including a corresponding node on a neighboring spoke', () => {
    const p = createPolarWarper(),
      i = 3 * 36 + 12;
    p.lightnessLocks![i + 1] = true;
    const next = moveSliceSelection(p, new Set([i]), 0.05);
    expect(next.lightness![i]).toBeCloseTo(0.05);
    expect(next.lightness![i + 1]).toBe(0);
    expect(next.lightness![i + 5]).toBeGreaterThan(0);
    expect(next.neutralLightness).toEqual(Array(7).fill(0));
  });
  it('pulls simultaneously and prevents slice rows crossing during large movements', () => {
    const p = createPolarWarper(),
      a = 2 * 36 + 12,
      b = 4 * 36 + 12;
    const x = pullSliceTogether(p, new Set([a, b])),
      y = pullSliceTogether(p, new Set([b, a]));
    expect(x.lightness).toEqual(y.lightness);
    expect(sliceLightness(x, b) - sliceLightness(x, a)).toBeCloseTo(1 / 6);
    const next = moveSliceSelection(x, new Set([a]), 10);
    for (let i = 0; i < 36; i++)
      for (let l = 0; l < 6; l++)
        expect(sliceLightness(next, (l + 1) * 36 + i) + 1e-7).toBeGreaterThanOrEqual(sliceLightness(next, l * 36 + i));
  });
  it('preserves explicit unpins and neutral metadata on angle resampling', () => {
    const p = createPolarWarper();
    p.locks!.fill(false);
    p.pinNeutrals = false;
    p.neutral = [0.01, 0.02];
    const next = resamplePolarWarper(p, 6, 6, 0.3, 60);
    expect(next.locks!.some(Boolean)).toBe(false);
    expect(next.neutral).toEqual(p.neutral);
    expect(next.pinNeutrals).toBe(false);
  });
});
