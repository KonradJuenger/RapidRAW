import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ColorWarper from '../../src/components/adjustments/ColorWarper';
import { useEditorStore } from '../../src/store/useEditorStore';
import { useEditorActions, debouncedSetHistory } from '../../src/hooks/useEditorActions';
import { createPolarWarper, resamplePolarWarper } from '../../src/utils/polarColorWarper';
import { getColorWarperDistributionSignature } from '../../src/utils/colorWarperDistribution';
import { THEMES } from '../../src/utils/themes';
import '../../src/i18n/index';
import '../../src/styles.css';
Object.entries(THEMES[0].cssVariables).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
document.body.style.background = '#1c1c1c';
let setAdjustments;
function Bench() {
  const adjustments = useEditorStore((s) => s.adjustments);
  setAdjustments = useEditorActions().setAdjustments;
  return (
    <div style={{ width: 380, padding: 16, color: 'white' }}>
      <ColorWarper adjustments={adjustments} setAdjustments={setAdjustments} />
    </div>
  );
}
flushSync(() => createRoot(document.getElementById('root')).render(<Bench />));
let current;
globalThis.warperBenchRecord = (name, ms) => {
  if (current) current[name] = (current[name] ?? 0) + ms;
};
globalThis.warperBenchFlags = { dots: true, background: true };
const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    median: +s[Math.floor(s.length / 2)].toFixed(3),
    p95: +s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)].toFixed(3),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
  };
};
function samples(count) {
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const h = rand() * Math.PI * 2,
      c = 0.3 * Math.pow(rand(), 1.8);
    return [rand(), Math.cos(h) * c, Math.sin(h) * c];
  });
}
async function scenario(
  { name, dots, background, wheelDots = true, sliceDots = true, count = 65536, spokes = 6, rings = 6 },
  repeat,
) {
  globalThis.warperBenchFlags = { dots, background, wheelDots, sliceDots };
  const base = createPolarWarper(spokes, rings);
  base.offsets[Math.floor(base.offsets.length / 3)] = [0.12, 0.01];
  const st = useEditorStore.getState();
  flushSync(() =>
    st.setEditor({
      adjustments: { ...st.adjustments, colorWarper: { ...st.adjustments.colorWarper, mode: 'linked', polar: base } },
      colorWarperDistribution: { width: 256, height: 128, planes: [[], []], points: samples(count) },
    }),
  );
  await raf();
  await raf();
  const rows = [];
  for (let i = 0; i < 24; i++) {
    await raf();
    current = {};
    const started = performance.now();
    const t = performance.now();
    const next = resamplePolarWarper(base, spokes, rings, 0.3, (i * 3.7 + repeat * 11) % 360);
    current.resample = performance.now() - t;
    flushSync(() => setAdjustments((prev) => ({ ...prev, colorWarper: { ...prev.colorWarper, polar: next } })));
    current.update = performance.now() - started;
    await raf();
    current.frame = performance.now() - started;
    if (i >= 4) rows.push(current);
    current = null;
  }
  debouncedSetHistory.cancel();
  const summary = {};
  for (const k of ['update', 'frame', 'resample', 'sliceBackground', 'wheelDots', 'sliceDots'])
    summary[k] = stats(rows.map((r) => r[k] ?? 0));
  return { name, repeat, count, spokes, rings, summary, rows };
}
globalThis.runWarperBenchmark = async (casesOverride) => {
  const cases = casesOverride ?? [
    { name: 'full', dots: true, background: true },
    { name: 'without-dots', dots: false, background: true },
    { name: 'without-background', dots: true, background: false },
    { name: 'mesh-only', dots: false, background: false },
    { name: 'full-16k', dots: true, background: true, count: 16384 },
    { name: 'dense-mesh-only', dots: false, background: false, spokes: 24, rings: 12 },
  ];
  const results = [];
  for (let repeat = 0; repeat < 2; repeat++)
    for (const c of repeat ? [...cases].reverse() : cases) {
      results.push(await scenario(c, repeat));
      globalThis.warperBenchProgress = results.map((r) => ({ name: r.name, repeat: r.repeat, summary: r.summary }));
    }
  const a = useEditorStore.getState().adjustments;
  const b = { ...a, colorWarper: { ...a.colorWarper, polar: { ...a.colorWarper.polar, angle: 123 } } };
  const gl = document.createElement('canvas').getContext('webgl'),
    ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const report = {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    production: import.meta.env.PROD,
    anglePreservesSampleSignature:
      getColorWarperDistributionSignature('fixture', a, 1200) ===
      getColorWarperDistributionSignature('fixture', b, 1200),
    notes:
      'Actual production React components; deterministic synthetic OKLab samples; no native image-preview pipeline. Timings include JS Canvas submission, not isolated GPU execution. 4 warmup + 20 measured updates per case per repeat. rAF frame timings are browser-dependent.',
    results,
  };
  globalThis.warperBenchmarkReport = report;
  return report;
};
