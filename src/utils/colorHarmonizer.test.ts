import { describe, expect, it } from 'vitest';
import { buildHarmonyMesh, createHarmonizer, harmonyNodes, normalizeHarmonizer } from './colorHarmonizer';
import { createDefaultColorWarper, normalizeColorWarper } from './colorWarper';
import { normalizePolarWarper } from './polarColorWarper';

describe('harmony polar mesh', () => {
  it('starts as identity and follows standard and custom palettes', () => {
    const s = createHarmonizer();
    expect(s.polar.offsets.every(([h, c]) => h === 0 && c === 0)).toBe(true);
    expect(harmonyNodes(s)).toEqual([30, 210]);
    expect(harmonyNodes({ ...s, rule: 'custom', count: 2, customHues: [350, 10, 90, 180] })).toEqual([350, 10]);
  });
  it('pulls intermediate hues toward the closest node and preserves node hue', () => {
    const s = { ...createHarmonizer(), rule: 'monochromatic' as const, anchor: 0, strength: 1, protection: 0 };
    const mesh = buildHarmonyMesh(s);
    expect(mesh.offsets[24 * 10][0]).toBeCloseTo(0);
    expect(mesh.offsets[24 * 10 + 2][0]).toBeLessThan(0);
    expect(mesh.offsets[24 * 10 + 22][0]).toBeGreaterThan(0);
    expect(normalizePolarWarper(mesh)).not.toBeNull();
  });
  it('applies saturation independently and protects low chroma', () => {
    const s = {
      ...createHarmonizer(),
      rule: 'monochromatic' as const,
      anchor: 0,
      saturations: [0.5, 1, 1, 1],
      protection: 1,
    };
    const mesh = buildHarmonyMesh(s);
    expect(mesh.offsets[0][1]).toBeLessThan(0);
    expect(Math.abs(mesh.offsets[0][1]) / (0.4 / 12)).toBeLessThan(
      Math.abs(mesh.offsets[24 * 8][1]) / ((0.4 * 9) / 12),
    );
  });
  it('round trips harmony and rejects invalid values', () => {
    const original = createDefaultColorWarper();
    original.mode = 'harmony';
    original.harmonizer = { ...createHarmonizer(), strength: 0.4 };
    const normalized = normalizeColorWarper(JSON.parse(JSON.stringify(original)));
    expect(normalized.mode).toBe('harmony');
    expect(normalized.harmonizer?.polar.offsets.some(([h]) => h !== 0)).toBe(true);
    expect(normalizeHarmonizer({ ...createHarmonizer(), width: -1 })).toBeNull();
  });
});
