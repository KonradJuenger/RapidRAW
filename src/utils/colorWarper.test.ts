import { describe, expect, it } from 'vitest';
import {
  computeScreenedInfluence,
  computeLinearGridInfluence,
  computeJoinedLightnessInfluence,
  createDefaultColorWarper,
  getPlaneNode,
  normalizeColorWarper,
  OKLAB_COLOR_SPACE,
  RAPIDRAW_DISPLAY_SRGB_D65,
  resampleColorWarper,
  samplePlaneOffset,
  setPlaneNode,
  warperCoordinatesToGamutMappedWorkingRgb,
  warperCoordinatesToWorkingRgb,
  workingRgbToWarperCoordinates,
} from './colorWarper';

describe('Color Warper state', () => {
  it('normalizes missing state and safely preserves an unsupported payload', () => {
    expect(normalizeColorWarper(undefined)).toEqual(createDefaultColorWarper());
    const future = { schemaVersion: 99, colorSpace: 'future', futureData: [1, 2, 3] };
    const normalized = normalizeColorWarper(future);
    expect(normalized.unsupportedState).toEqual(future);
    expect(normalized.planes).toEqual(createDefaultColorWarper().planes);
  });

  it('migrates the four-ray schema to Cartesian-volume controls without losing edits', () => {
    const current = createDefaultColorWarper(5);
    current.planes[0].offsets[6] = [0.05, -0.03];
    const legacy = {
      ...current,
      schemaVersion: 1,
      meshMode: 'chroma-luma-four-ray',
      interpolation: 'smooth-bilinear',
    };
    const migrated = normalizeColorWarper(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.meshMode).toBe('cartesian-volume');
    expect(migrated.interpolation).toBe('smooth-trilinear');
    expect(migrated.planes[0].offsets[6]).toEqual([0.05, -0.03]);
  });

  it('bypasses and preserves malformed dense arrays', () => {
    const malformed = { ...createDefaultColorWarper(5), planes: [{ offsets: [], locks: [] }] };
    const normalized = normalizeColorWarper(malformed);
    expect(normalized.unsupportedState).toEqual(malformed);
    expect(normalized.gridSize).toBe(7);
  });

  it('bypasses node positions outside the editable mesh domain', () => {
    const invalid = createDefaultColorWarper(5);
    invalid.planes[0].offsets[0] = [1, 0];
    expect(normalizeColorWarper(invalid).unsupportedState).toEqual(invalid);
  });

  it('maps both center columns to one logical neutral axis', () => {
    const state = createDefaultColorWarper(5);
    const centerIndex = 2 * 5 + 2;
    setPlaneNode(state, 0, centerIndex, [0.08, 0.12], true);
    setPlaneNode(state, 1, centerIndex, [-0.04, 0.12]);

    expect(getPlaneNode(state, 0, centerIndex)).toEqual({ offset: [0.08, 0.12], locked: true });
    expect(getPlaneNode(state, 1, centerIndex)).toEqual({ offset: [-0.04, 0.12], locked: true });
  });

  it('solves a screened incremental influence without modifying constraints', () => {
    const selected = new Set([12]);
    const locked = new Set([11]);
    const weights = computeScreenedInfluence(5, selected, locked);
    expect(weights[12]).toBe(1);
    expect(weights[11]).toBe(0);
    expect(weights[7]).toBeGreaterThan(0);
    expect(weights[0]).toBeLessThan(weights[7]);
  });

  it('uses one joined lightness graph with a shared neutral axis', () => {
    const selected: [Set<number>, Set<number>] = [new Set([12]), new Set()];
    const locked: [Set<number>, Set<number>] = [new Set(), new Set()];
    const weights = computeJoinedLightnessInfluence(5, selected, locked);
    for (let row = 0; row < 5; row += 1) {
      const center = row * 5 + 2;
      expect(weights[0][center]).toBeCloseTo(weights[1][center], 7);
    }
    expect(weights[1][13]).toBeGreaterThan(0);
  });

  it('resamples deformation and retains isolated locks', () => {
    const state = createDefaultColorWarper(5);
    setPlaneNode(state, 0, 6, [0.05, -0.03], true);
    const upsampled = resampleColorWarper(state, 13);
    expect(getPlaneNode(upsampled, 0, 3 * 13 + 3).locked).toBe(true);
    expect(getPlaneNode(upsampled, 0, 3 * 13 + 3).offset[0]).toBeCloseTo(0.05, 5);
  });

  it('pins corners and the middle column by default', () => {
    const state = createDefaultColorWarper(5);
    const center = Math.floor(5 / 2);
    // Corners on both planes must be locked
    for (const plane of [0, 1] as const) {
      for (const corner of [0, 4, 20, 24]) {
        expect(getPlaneNode(state, plane, corner).locked).toBe(true);
      }
      // An interior non-middle node should not be locked
      expect(getPlaneNode(state, plane, 6).locked).toBe(false);
    }
    // Entire middle column must be locked
    for (let row = 0; row < 5; row += 1) {
      expect(getPlaneNode(state, 0, row * 5 + center).locked).toBe(true);
      expect(getPlaneNode(state, 1, row * 5 + center).locked).toBe(true);
    }
  });

  it('smoothly interpolates within the explicit chroma range', () => {
    const state = createDefaultColorWarper(5, 0.4);
    setPlaneNode(state, 0, 0, [0.1, -0.2]);
    expect(samplePlaneOffset(state, 0, -0.3, 1.0)[0]).toBeCloseTo(0.05, 5);
    expect(samplePlaneOffset(state, 0, -0.3, 1.0)[1]).toBeCloseTo(-0.1, 5);
    expect(samplePlaneOffset(state, 0, -0.35, 1.0)[0]).toBeCloseTo(0.084375, 5);
    expect(samplePlaneOffset(state, 0, -0.5, 1.0)[0]).toBeCloseTo(0.1, 5);
  });

  it('uses shared defaults and rejects invalid fields without losing their payload', () => {
    const state = createDefaultColorWarper();
    const { gridSize: _grid, chromaLimit: _limit, ...withoutDefaults } = state;
    expect(normalizeColorWarper(withoutDefaults)).toEqual(state);
    for (const invalid of [
      { ...state, gridSize: 6 },
      { ...state, chromaLimit: 0.05 },
      { ...state, chromaLimit: null },
      { ...state, axisAngle: null },
      { ...state, planes: [{ ...state.planes[0], locks: [] }, state.planes[1]] },
    ]) {
      expect(normalizeColorWarper(invalid).unsupportedState).toEqual(invalid);
    }
    const normalized = normalizeColorWarper({ ...state, axisAngle: -405 });
    expect(normalized.axisAngle).toBe(315);
    const future = normalizeColorWarper({ schemaVersion: 99 });
    expect(resampleColorWarper(future, 5).unsupportedState).toEqual({ schemaVersion: 99 });
  });

  it('computes linear harmonic influence between pinned points', () => {
    // 5x5 grid with corners and middle column locked
    const locked = new Set([0, 4, 20, 24, 2, 7, 12, 17, 22]);
    // Drag node 11 (row 2, col 1)
    const selected = new Set([11]);
    const weights = computeScreenedInfluence(5, selected, locked);
    expect(weights[11]).toBe(1);
    expect(weights[12]).toBe(0); // middle column is locked anchor
    // Weight at 11 is 1, weight at 12 is 0. In harmonic solution, neighbours diffuse linearly.
    expect(weights[10]).toBeGreaterThan(0.4);
    expect(weights[6]).toBeGreaterThan(0.2);
  });

  it('computes exact piecewise linear 2D grid influence between anchors', () => {
    // 7x7 grid with corners and middle column locked
    const locked = new Set([0, 6, 42, 48]);
    for (let r = 0; r < 7; r += 1) locked.add(r * 7 + 3);

    // Select (col 5, row 4)
    const selected = new Set([4 * 7 + 5]);
    const weights = computeLinearGridInfluence(7, selected, locked);

    // Selected point is 1.0
    expect(weights[4 * 7 + 5]).toBe(1.0);
    // Locked points are strictly 0.0
    expect(weights[4 * 7 + 3]).toBe(0.0);
    expect(weights[4 * 7 + 6]).toBe(0.0); // right boundary
    expect(weights[0 * 7 + 5]).toBe(0.0); // top boundary
    expect(weights[6 * 7 + 5]).toBe(0.0); // bottom boundary

    // Along row 4: col 4 is midpoint between col 3 (0.0) and col 5 (1.0) -> exactly 0.5
    expect(weights[4 * 7 + 4]).toBeCloseTo(0.5, 5);

    // Opposite (left) side of middle column has 0 influence
    expect(weights[4 * 7 + 1]).toBe(0.0);
    expect(weights[4 * 7 + 2]).toBe(0.0);
  });
});

describe('Color conversion reference behavior', () => {
  it('round-trips extended display-stage values without clipping', () => {
    const rgb: [number, number, number] = [-0.08, 0.42, 1.17];
    const result = warperCoordinatesToWorkingRgb(
      RAPIDRAW_DISPLAY_SRGB_D65,
      OKLAB_COLOR_SPACE,
      workingRgbToWarperCoordinates(RAPIDRAW_DISPLAY_SRGB_D65, OKLAB_COLOR_SPACE, rgb),
    );
    result.forEach((value, index) => expect(value).toBeCloseTo(rgb[index], 5));
  });

  it('gamut-maps out-of-gamut coordinates without false hue flips (no green in dark yellow)', () => {
    // L=0.05, a=0, b=0.4 (dark yellow/warm, out of gamut)
    const outOfGamutYellow = warperCoordinatesToGamutMappedWorkingRgb(
      RAPIDRAW_DISPLAY_SRGB_D65,
      OKLAB_COLOR_SPACE,
      [0.05, 0, 0.4],
    );
    expect(outOfGamutYellow.inGamut).toBe(false);
    // Green must not dominate (which was the bug where naive clamp produced [0, 50, 0] pure green)
    expect(outOfGamutYellow.rgb[1]).toBeLessThanOrEqual(outOfGamutYellow.rgb[0] + 0.01);
    // In-gamut check: all channels within [0, 1]
    outOfGamutYellow.rgb.forEach((ch) => {
      expect(ch).toBeGreaterThanOrEqual(-1e-5);
      expect(ch).toBeLessThanOrEqual(1 + 1e-5);
    });

    // In-gamut coordinate: L=0.8, a=0, b=0.1
    const inGamutColor = warperCoordinatesToGamutMappedWorkingRgb(
      RAPIDRAW_DISPLAY_SRGB_D65,
      OKLAB_COLOR_SPACE,
      [0.8, 0, 0.1],
    );
    expect(inGamutColor.inGamut).toBe(true);
    const directRgb = warperCoordinatesToWorkingRgb(RAPIDRAW_DISPLAY_SRGB_D65, OKLAB_COLOR_SPACE, [0.8, 0, 0.1]);
    expect(inGamutColor.rgb[0]).toBeCloseTo(directRgb[0], 4);
    expect(inGamutColor.rgb[1]).toBeCloseTo(directRgb[1], 4);
    expect(inGamutColor.rgb[2]).toBeCloseTo(directRgb[2], 4);
  });

  it('preserves and resamples configurable chromaLimit', () => {
    const state = createDefaultColorWarper(5, 0.2);
    expect(state.chromaLimit).toBe(0.2);
    const normalized = normalizeColorWarper({ ...state, chromaLimit: 0.2 });
    expect(normalized.chromaLimit).toBe(0.2);

    // Resample to 0.4
    const resampled = resampleColorWarper(state, 5, 0.4);
    expect(resampled.chromaLimit).toBe(0.4);
  });
});
