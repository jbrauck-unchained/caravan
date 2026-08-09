/**
 * Provisional browser-release timing policy.
 *
 * The quiet period exceeds WebHID transport 1.2.4's pinned 6,000 ms automatic
 * reconnection window. Every value remains subject to physical Chrome/Edge
 * calibration before production release.
 */
export interface HidReleasePolicy {
  readonly snapshotTimeoutMs: number;
  readonly disconnectTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly reconnectQuietPeriodMs: number;
  readonly releaseDeadlineMs: number;
}

export const PROVISIONAL_HID_RELEASE_POLICY: HidReleasePolicy = Object.freeze({
  snapshotTimeoutMs: 1_000,
  disconnectTimeoutMs: 1_000,
  pollIntervalMs: 100,
  reconnectQuietPeriodMs: 6_500,
  releaseDeadlineMs: 10_000,
});
