# Linked Color Warper benchmark

This production-browser benchmark separates canvas point rendering from slice background rendering, mesh resampling, and React/SVG updates. It does not modify the application implementation. The build plugin inserts effect timers and bypass flags into the benchmark bundle only.

## Run

From the repository root:

```powershell
npx vite build --config scripts/benchmarks/warper.config.mjs
npx vite preview --config scripts/benchmarks/warper.config.mjs --host 127.0.0.1 --port 1426
```

In a second terminal:

```powershell
npx --yes agent-browser --session warper-perf open http://127.0.0.1:1426/scripts/benchmarks/warper.html
npx --yes agent-browser --session warper-perf set viewport 600 1200
npx --yes agent-browser --session warper-perf eval "void runWarperBenchmark().catch(e=>globalThis.warperBenchError=String(e))"
npx --yes agent-browser --session warper-perf eval "({done:!!globalThis.warperBenchmarkReport,progress:globalThis.warperBenchProgress,error:globalThis.warperBenchError})"
```

Once `done` is true, export:

```powershell
$result = npx --yes agent-browser --session warper-perf eval "globalThis.warperBenchmarkReport" --json | ConvertFrom-Json
$result.data.result | ConvertTo-Json -Depth 20 | Set-Content scripts/benchmarks/warper-results.json
```

For dot scaling and independently disabling the wheel redraw, reload and run:

```javascript
runWarperBenchmark([
  { name: 'dots-16k', dots: true, background: false, count: 16384 },
  { name: 'dots-32k', dots: true, background: false, count: 32768 },
  { name: 'dots-48k', dots: true, background: false, count: 49152 },
  { name: 'slice-dots-only-65k', dots: true, background: false, wheelDots: false },
  { name: 'without-wheel-redraw', dots: true, background: true, wheelDots: false },
]);
```

## Method and limits

- Production React build, actual ColorWarper components, real resampling and `useEditorActions().setAdjustments` path, synchronously flushed to measure update work. This scripts the slider's update logic, not physical mouse event delivery.
- Deterministic synthetic OKLab point cloud; 380px container; device pixel ratio 1. Samples are not regenerated during angle changes.
- Each scenario has four warmup updates and twenty measured updates. Repeat twice, reversing scenario order on the second pass. Summary combines forty measured updates per scenario.
- Angle changes are 3.7 degrees per update, resampled from the gesture baseline. Fixture includes a small deformation. Default mesh 6 spokes × 6 rings; dense mesh 24 × 12.
- `update`: resampling plus synchronous React/DOM/effect work. `frame`: elapsed through the next animation-frame callback, not FPS. Effect timers measure Canvas API work/submission and possible waits; they are not isolated GPU execution timings. GPU/canvas work can shift between these measurements, so component medians are not additive.
- Native Tauri image processing, GPU readback, IPC, image decoding, and actual image-preview updates are excluded. Results establish frontend bottlenecks; they do not measure total native-app latency.
- The report checks that changing only the polar angle preserves the sample-request cache signature.

## Results, 2026-09-12

Chrome 153 headless on Windows, AMD Radeon 880M exposed through ANGLE/D3D11, 20 logical processors, production build. WebGL renderer identification does not independently establish the Canvas 2D acceleration path.

Median synchronous update time, milliseconds:

| Scenario                                  | Median |   p95 |
| ----------------------------------------- | -----: | ----: |
| Full linked view, 65,536 samples          |  266.6 | 323.6 |
| Dots disabled; background and grid active |   66.3 |  67.6 |
| Background disabled; dots and grid active |  220.8 | 263.6 |
| Both disabled; default grid active        |    1.3 |   1.9 |
| Both disabled; maximum grid active        |    3.5 |   4.6 |
| Only wheel dot redraw disabled            |   76.1 |  79.0 |
| Full linked view, 16,384 samples          |   76.4 |  78.3 |

**Independent non-dot bottleneck:** slice background reconstruction is 65–67ms per angle update. It evaluates 414 × 324 = 134,136 pixels, including color conversion and up to eight additional gamut-search iterations per out-of-gamut pixel. That work alone exceeds a 16.7ms frame budget. The deformation resampler is only 0.1ms at default mesh size and 0.4ms at maximum size. General React/SVG mesh updates are not the main problem in this test.

**Separate dot bottleneck:** the wheel effect redraws on angle changes even though its a/b projection is unchanged. In the full run it measures 183.7ms median at 65k samples; slice dots measure 8.7ms. At 16k samples the wheel measures 6.9ms. The separate scaling run shows substantial extra frame delay and high-tail stalls at larger point counts. This supports excessive Canvas rendering/submission work, but does not identify a specific driver/flush threshold without a browser trace.

**Priority:** optimize the slice background independently; separately avoid unnecessary wheel-dot redraws and benchmark alternative point rendering. No evidence here supports prioritizing a rewrite of mesh resampling or increasing cache dimensions—the sample data already contains three dimensions, and the angle preserves its request signature.

Raw measurements: `warper-results.json`, `warper-dot-results.json`. Combined medians/p95: `warper-summary.json`.

## After preview and wheel-cache optimization

Same production-browser benchmark and fixture, 2026-09-12. Raw data: `warper-optimized-results.json`; combined statistics: `warper-optimized-summary.json`.

| Full view, 65k points                      | Before median | After median |
| ------------------------------------------ | ------------: | -----------: |
| Synchronous angle update                   |       266.6ms |       16.2ms |
| Slice-background effect                    |        66.6ms |        4.2ms |
| Wheel-dot effect during angle updates      |       183.7ms | 0ms (cached) |
| Time through next animation-frame callback |       272.0ms |       33.8ms |

The background now samples 96×72 colors and uses smooth browser scaling. The wheel canvas persists across mesh and angle changes; its dependencies track the actual samples and projection range, and a ResizeObserver handles size changes. A browser interaction check observed zero wheel redraws after angle changes and one redraw when increasing the panel width (346px to 466px canvas). The preview remained smooth in the visual check; build and targeted lint passed. Slice-dot drawing is now the largest measured update component at 10.1ms median. This is a roughly 16× reduction in synchronous frontend update time, not a claim of 16× native-app FPS.
