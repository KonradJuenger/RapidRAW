import { describe, expect, it } from 'vitest';
import { INITIAL_ADJUSTMENTS } from './adjustments';
import { cloneColorWarper, setPlaneNode } from './colorWarper';
import { ColorWarperDistributionRequests, getColorWarperDistributionSignature } from './colorWarperDistribution';

const state = () => structuredClone(INITIAL_ADJUSTMENTS);

describe('Color Warper distribution signature', () => {
  it('does not mutate settings or serialize pixel payloads and notices replaced payloads', () => {
    const baseline = state();
    baseline.aiPatches = [
      {
        id: 'patch',
        isLoading: false,
        invert: false,
        name: 'Patch',
        patchData: '0.25'.repeat(10000),
        prompt: '',
        subMasks: [],
        visible: true,
      },
    ];
    const original = structuredClone(baseline);
    const signature = getColorWarperDistributionSignature('image', baseline);
    expect(getColorWarperDistributionSignature('image', baseline)).toBe(signature);
    expect(getColorWarperDistributionSignature('image', { ...baseline })).toBe(signature);
    expect(signature.length).toBeLessThan(10000);
    expect(baseline).toEqual(original);
    baseline.aiPatches[0].patchData = '0.5'.repeat(10000);
    expect(getColorWarperDistributionSignature('image', baseline)).not.toBe(signature);
  });
  it('ignores mesh edits, locks, density, and downstream finishing', () => {
    const baseline = state();
    const changed = state();
    changed.colorWarper = cloneColorWarper(changed.colorWarper);
    setPlaneNode(changed.colorWarper, 0, 0, [0.1, -0.05], true);
    changed.colorWarper.gridSize = 13;
    changed.grainAmount = 80;
    changed.lutPath = 'display.cube';
    changed.lutIntensity = 25;
    changed.showClipping = true;
    expect(getColorWarperDistributionSignature('image', changed, 1920)).toBe(
      getColorWarperDistributionSignature('image', baseline, 1920),
    );
  });

  it('changes for upstream edits, angle, source, resolution, and scene LUTs', () => {
    const baseline = state();
    const signature = getColorWarperDistributionSignature('image', baseline, 1920);
    const upstream = state();
    upstream.exposure = 1;
    expect(getColorWarperDistributionSignature('image', upstream, 1920)).not.toBe(signature);
    const angle = state();
    angle.colorWarper.axisAngle = 30;
    expect(getColorWarperDistributionSignature('image', angle, 1920)).not.toBe(signature);
    const sceneLut = state();
    sceneLut.lutIsSceneReferred = true;
    sceneLut.lutPath = 'scene.cube';
    expect(getColorWarperDistributionSignature('image', sceneLut, 1920)).not.toBe(signature);
    expect(getColorWarperDistributionSignature('other', baseline, 1920)).not.toBe(signature);
    expect(getColorWarperDistributionSignature('image', baseline, 2048)).not.toBe(signature);
  });
});

describe('Color Warper distribution requests', () => {
  it('accepts only the current result and acknowledges successful readback', () => {
    const requests = new ColorWarperDistributionRequests();
    const old = requests.begin('old', 0)!;
    const latest = requests.begin('latest', 1)!;
    expect(requests.complete(old, true, 2)).toBe(false);
    expect(requests.begin('latest', 3)).toBeNull();
    expect(requests.complete(latest, true, 4)).toBe(true);
    expect(requests.begin('latest', 6000)).toBeNull();
    expect(requests.needsRetry(6000)).toBe(false);
  });

  it('retries failed or lost readbacks with a limit and recovers on a new state', () => {
    const requests = new ColorWarperDistributionRequests();
    const first = requests.begin('image', 0)!;
    expect(requests.complete(first, false, 100)).toBe(false);
    expect(requests.begin('image', 1099)).toBeNull();
    const second = requests.begin('image', 1100)!;
    expect(second).not.toBe(first);
    expect(requests.needsRetry(6099)).toBe(false);
    const third = requests.begin('image', 6100)!;
    expect(third).not.toBe(second);
    expect(requests.begin('image', 12000)).toBeNull();
    expect(requests.begin('changed', 12001)).not.toBeNull();
    requests.reset();
    expect(requests.complete(third, true)).toBe(false);
    expect(requests.begin('image', 12002)).not.toBeNull();
  });
});

it('reuses real color samples when the grid alignment or slice selection changes', () => {
  const p = state();
  p.colorWarper.mode = 'linked';
  const signature = getColorWarperDistributionSignature('image', p);
  for (const change of [{ angle: 20 }, { sliceSpoke: 2 }, { spokes: 12 }]) {
    const next = structuredClone(p);
    Object.assign(next.colorWarper.polar!, change);
    expect(getColorWarperDistributionSignature('image', next)).toBe(signature);
  }
  p.colorWarper.polar!.offsets[0] = [0.2, 0.01];
  expect(getColorWarperDistributionSignature('image', p)).toBe(signature);
});
