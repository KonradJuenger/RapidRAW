import { createPolarWarper, type PolarWarperState } from './polarColorWarper';

export const HARMONY_RULES = {
  monochromatic: [0],
  analogous: [0, -30, 30],
  analogousComplementary: [0, -30, 30, 180],
  complementary: [0, 180],
  splitComplementary: [0, 150, 210],
  dyad: [-30, 30],
  triad: [0, 120, 240],
  tetrad: [-30, 30, 150, 210],
  square: [0, 90, 180, 270],
} as const;
export type HarmonyRule = keyof typeof HARMONY_RULES | 'custom';
export interface HarmonizerState {
  rule: HarmonyRule;
  anchor: number;
  strength: number;
  width: number;
  protection: number;
  customHues: number[];
  saturations: number[];
  count: number;
  polar: PolarWarperState;
}
const wrap = (v: number) => ((((v + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
export const harmonyNodes = (s: HarmonizerState): number[] =>
  (s.rule === 'custom' ? s.customHues.slice(0, s.count) : HARMONY_RULES[s.rule].map((d) => s.anchor + d)).map(
    (d) => ((d % 360) + 360) % 360,
  );
export function buildHarmonyMesh(s: HarmonizerState): PolarWarperState {
  const p = createPolarWarper(24, 12, 0.4);
  const nodes = harmonyNodes(s).map((d) => (d * Math.PI) / 180);
  p.offsets = p.offsets.map((_, i) => {
    const hue = ((i % p.spokes) * 2 * Math.PI) / p.spokes;
    const chroma = ((Math.floor(i / p.spokes) + 1) * p.chromaLimit) / p.rings;
    let best = 0;
    for (let j = 1; j < nodes.length; j++)
      if (Math.abs(wrap(nodes[j] - hue)) < Math.abs(wrap(nodes[best] - hue))) best = j;
    const delta = wrap(nodes[best] - hue);
    const zone = Math.PI / Math.max(nodes.length, 1);
    const falloff = Math.exp(-0.5 * (delta / (zone * s.width)) ** 2);
    const protection = chroma / (chroma + s.protection * 0.12 + 1e-8);
    const hueShift = delta * s.strength * falloff * protection;
    const saturation = 1 + (s.saturations[best] - 1) * falloff * protection;
    return [hueShift, saturation === 1 ? 0 : Math.max(0, Math.min(p.chromaLimit, chroma * saturation)) - chroma];
  });
  return p;
}
export function createHarmonizer(): HarmonizerState {
  const state: HarmonizerState = {
    rule: 'complementary',
    anchor: 30,
    strength: 0,
    width: 1,
    protection: 0.5,
    customHues: [0, 90, 180, 270],
    saturations: [1, 1, 1, 1],
    count: 4,
    polar: createPolarWarper(24, 12, 0.4),
  };
  state.polar = buildHarmonyMesh(state);
  return state;
}
export function normalizeHarmonizer(raw: unknown): HarmonizerState | null {
  if (raw === undefined) return createHarmonizer();
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as HarmonizerState;
  if (
    !(s.rule === 'custom' || Object.hasOwn(HARMONY_RULES, s.rule)) ||
    !Number.isFinite(s.anchor) ||
    s.anchor < 0 ||
    s.anchor > 360 ||
    !Number.isFinite(s.strength) ||
    s.strength < 0 ||
    s.strength > 1 ||
    !Number.isFinite(s.width) ||
    s.width < 0.25 ||
    s.width > 4 ||
    !Number.isFinite(s.protection) ||
    s.protection < 0 ||
    s.protection > 1 ||
    !Number.isInteger(s.count) ||
    s.count < 2 ||
    s.count > 4 ||
    !Array.isArray(s.customHues) ||
    s.customHues.length !== 4 ||
    !s.customHues.every((x) => Number.isFinite(x) && x >= 0 && x <= 360) ||
    !Array.isArray(s.saturations) ||
    s.saturations.length !== 4 ||
    !s.saturations.every((x) => Number.isFinite(x) && x >= 0 && x <= 2)
  )
    return null;
  return { ...s, customHues: [...s.customHues], saturations: [...s.saturations], polar: buildHarmonyMesh(s) };
}
