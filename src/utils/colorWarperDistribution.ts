import type { Adjustments } from './adjustments';

const payloadVersions = new WeakMap<object, Map<string, { value: unknown; version: number }>>();
let nextPayloadVersion = 0;
const payloadKeys = new Set(['patchData', 'maskDataBase64']);

function signatureValue(this: object, key: string, value: unknown): unknown {
  if (!payloadKeys.has(key) || value == null) return value;
  // Adjustment payloads are immutable. Track their identity without serializing pixels.
  let versions = payloadVersions.get(this);
  if (!versions) payloadVersions.set(this, (versions = new Map()));
  let cached = versions.get(key);
  if (!cached || cached.value !== value) {
    cached = { value, version: ++nextPayloadVersion };
    versions.set(key, cached);
  }
  return { payloadVersion: cached.version };
}

/** Canonical key for pixels entering the warper, excluding the deformation and downstream finish. */
export const getColorWarperDistributionSignature = (
  path: string,
  adjustments: Adjustments,
  targetResolution?: number,
): string => {
  const upstream = { ...adjustments } as unknown as Record<string, unknown>;
  upstream.colorWarper = {
    mode: adjustments.colorWarper.mode ?? 'grid',
    polarChromaLimit: adjustments.colorWarper.polar?.chromaLimit,
    schemaVersion: adjustments.colorWarper.schemaVersion,
    colorSpace: adjustments.colorWarper.colorSpace,
    axisAngle: adjustments.colorWarper.axisAngle,
    chromaLimit: adjustments.colorWarper.chromaLimit,
  };
  upstream.sectionVisibility = { ...adjustments.sectionVisibility, colorWarper: true };

  delete upstream.grainAmount;
  delete upstream.grainSize;
  delete upstream.grainRoughness;
  delete upstream.showClipping;
  // The backend loads LUT pixels from lutPath; these fields are UI/import metadata.
  delete upstream.lutData;
  delete upstream.lutName;
  if (!adjustments.lutIsSceneReferred) {
    delete upstream.lutPath;
    delete upstream.lutSize;
    delete upstream.lutIntensity;
    delete upstream.lutIsSceneReferred;
  }
  return JSON.stringify({ path, targetResolution, upstream }, function (this: object, key: string, value: unknown) {
    return signatureValue.call(this === upstream ? adjustments : this, key, value);
  });
};

// The event may arrive after its preview command, or after a newer request.
export class ColorWarperDistributionRequests {
  private completed = '';
  private pending: { signature: string; id: string; attempts: number; retryAt: number } | null = null;

  reset() {
    this.completed = '';
    this.pending = null;
  }

  needsRetry(now = Date.now()) {
    return this.pending !== null && this.pending.attempts < 3 && now >= this.pending.retryAt;
  }

  begin(signature: string, now = Date.now()): string | null {
    if (signature === this.completed) {
      this.pending = null;
      return null;
    }
    const same = this.pending?.signature === signature;
    if (same && !this.needsRetry(now)) return null;
    const id = crypto.randomUUID();
    this.pending = { signature, id, attempts: same ? this.pending!.attempts + 1 : 1, retryAt: now + 5000 };
    return id;
  }

  complete(id: string, succeeded: boolean, now = Date.now()): boolean {
    if (this.pending?.id !== id) return false;
    if (!succeeded) {
      this.pending.retryAt = now + 1000;
      return false;
    }
    this.completed = this.pending.signature;
    this.pending = null;
    return true;
  }
}

export const colorWarperDistributionRequests = new ColorWarperDistributionRequests();
