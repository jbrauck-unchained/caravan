import { PROVISIONAL_HID_RELEASE_POLICY } from "./hidReleasePolicy";

describe("provisional HID release policy", () => {
  it("pins bounded timings beyond WebHID's reviewed reconnect window", () => {
    expect(PROVISIONAL_HID_RELEASE_POLICY).toEqual({
      snapshotTimeoutMs: 1_000,
      disconnectTimeoutMs: 1_000,
      pollIntervalMs: 100,
      reconnectQuietPeriodMs: 6_500,
      releaseDeadlineMs: 10_000,
    });
    expect(PROVISIONAL_HID_RELEASE_POLICY.releaseDeadlineMs).toBeGreaterThan(
      PROVISIONAL_HID_RELEASE_POLICY.reconnectQuietPeriodMs,
    );
    expect(Object.isFrozen(PROVISIONAL_HID_RELEASE_POLICY)).toBe(true);
  });
});
