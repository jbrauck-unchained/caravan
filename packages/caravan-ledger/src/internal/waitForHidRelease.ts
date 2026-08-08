import type { Clock, ClockTimer } from "./clock";
import {
  hidSnapshotMatchesModel,
  isKnownCandidateIdentity,
  isKnownOpenPeerIdentity,
  type HidReleaseCandidate,
  LEDGER_HID_VENDOR_ID,
} from "./hidCandidate";
import type {
  HidDeviceChange,
  HidDeviceIdentity,
  HidDeviceSnapshot,
  HidPort,
} from "./hidPort";
import {
  PROVISIONAL_HID_RELEASE_POLICY,
  type HidReleasePolicy,
} from "./hidReleasePolicy";

export type HidReleaseOutcome =
  | "released"
  | "ambiguous"
  | "unavailable"
  | "timed-out";

export interface HidReleaseBarrier {
  /** Attach change observation and snapshot immediately before disconnect. */
  arm(): Promise<void>;
  /** Await release only after the SDK disconnect attempt has settled/bounded. */
  wait(): Promise<HidReleaseOutcome>;
  /** Internal hard teardown. Ordinary installer cancellation should await wait. */
  cancel(): void;
}

export interface CreateHidReleaseBarrierOptions {
  readonly candidate: HidReleaseCandidate;
  readonly clock: Clock;
  readonly hidPort: HidPort;
  readonly policy?: HidReleasePolicy;
}

type UniqueHidCandidate = Extract<
  HidReleaseCandidate,
  { readonly kind: "unique" }
>;

type MatchingSnapshotInspection =
  | {
      readonly status: "available";
      readonly candidate: HidDeviceSnapshot | undefined;
      readonly hasMatchingDevice: boolean;
      readonly hasUnknownIdentity: boolean;
      readonly hasUnexpectedOpenedPeer: boolean;
    }
  | { readonly status: "unavailable" };

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function assertValidPolicy(policy: HidReleasePolicy): void {
  if (
    !isPositiveSafeInteger(policy.snapshotTimeoutMs) ||
    !isPositiveSafeInteger(policy.disconnectTimeoutMs) ||
    !isPositiveSafeInteger(policy.pollIntervalMs) ||
    !isPositiveSafeInteger(policy.reconnectQuietPeriodMs) ||
    !isPositiveSafeInteger(policy.releaseDeadlineMs) ||
    policy.releaseDeadlineMs <= policy.reconnectQuietPeriodMs
  ) {
    throw new TypeError("The HID release timing policy is invalid.");
  }
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function isUsbIdentifier(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 0xffff
  );
}

function inspectMatchingSnapshots(
  snapshots: readonly HidDeviceSnapshot[],
  candidate: UniqueHidCandidate,
): MatchingSnapshotInspection {
  if (!Array.isArray(snapshots)) return { status: "unavailable" };

  const identities = new Set<HidDeviceIdentity>();
  let exactCandidate: HidDeviceSnapshot | undefined;
  let hasMatchingDevice = false;
  let hasUnknownIdentity = false;
  let hasUnexpectedOpenedPeer = false;

  try {
    for (let index = 0; index < snapshots.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(snapshots, index)) {
        return { status: "unavailable" };
      }
      const snapshot: unknown = snapshots[index];
      if (!isObject(snapshot)) return { status: "unavailable" };
      const identity: unknown = Reflect.get(snapshot, "identity");
      const vendorId: unknown = Reflect.get(snapshot, "vendorId");
      if (
        !isObject(identity) ||
        !isUsbIdentifier(vendorId)
      ) {
        return { status: "unavailable" };
      }
      const deviceIdentity = identity as HidDeviceIdentity;
      if (identities.has(deviceIdentity)) return { status: "unavailable" };
      identities.add(deviceIdentity);

      if (
        deviceIdentity === candidate.identity &&
        vendorId !== LEDGER_HID_VENDOR_ID
      ) {
        return { status: "unavailable" };
      }
      if (vendorId !== LEDGER_HID_VENDOR_ID) continue;

      const productId: unknown = Reflect.get(snapshot, "productId");
      const opened: unknown = Reflect.get(snapshot, "opened");
      if (!isUsbIdentifier(productId) || typeof opened !== "boolean") {
        return { status: "unavailable" };
      }
      const validatedSnapshot: HidDeviceSnapshot = Object.freeze({
        identity: deviceIdentity,
        vendorId,
        productId,
        opened,
      });

      if (deviceIdentity === candidate.identity) {
        if (
          productId !== candidate.productId ||
          !hidSnapshotMatchesModel(validatedSnapshot, candidate.modelId)
        ) {
          return { status: "unavailable" };
        }
        exactCandidate = validatedSnapshot;
        hasMatchingDevice = true;
        continue;
      }
      if (!hidSnapshotMatchesModel(validatedSnapshot, candidate.modelId)) {
        continue;
      }
      hasMatchingDevice = true;
      if (!isKnownCandidateIdentity(candidate, deviceIdentity)) {
        hasUnknownIdentity = true;
      } else if (
        opened &&
        !isKnownOpenPeerIdentity(candidate, deviceIdentity)
      ) {
        hasUnexpectedOpenedPeer = true;
      }
    }
  } catch {
    return { status: "unavailable" };
  }

  return {
    status: "available",
    candidate: exactCandidate,
    hasMatchingDevice,
    hasUnknownIdentity,
    hasUnexpectedOpenedPeer,
  };
}

function initialOutcome(candidate: HidReleaseCandidate): HidReleaseOutcome | undefined {
  switch (candidate.kind) {
    case "unique":
      return undefined;
    case "ambiguous":
      return "ambiguous";
    case "none":
    case "unavailable":
      return "unavailable";
  }
}

/**
 * Observe one privately selected HID candidate without acquiring or closing it.
 *
 * Removal requires a quiet period because pinned WebHID can retain a hidden
 * same-product reconnection actor after DMK reports disconnect completion.
 */
export function createHidReleaseBarrier({
  candidate,
  clock,
  hidPort,
  policy = PROVISIONAL_HID_RELEASE_POLICY,
}: CreateHidReleaseBarrierOptions): HidReleaseBarrier {
  assertValidPolicy(policy);

  const uniqueCandidate = candidate.kind === "unique" ? candidate : undefined;
  let terminalOutcome = initialOutcome(candidate);
  let armPromise: Promise<void> | undefined;
  let waitPromise: Promise<HidReleaseOutcome> | undefined;
  let resolveWait: ((outcome: HidReleaseOutcome) => void) | undefined;
  let unsubscribeChanges: (() => void) | undefined;
  let unsubscribePending = false;
  let abortArmSnapshot: (() => void) | undefined;
  let deadlineTimer: ClockTimer | undefined;
  let quietTimer: ClockTimer | undefined;
  let pollTimer: ClockTimer | undefined;
  let pollInFlight = false;
  let deadlineAt: number | undefined;
  let quietDeadlineAt: number | undefined;
  let lastMonotonicNow: number | undefined;
  let candidateObservedAbsent = false;
  let quietPeriodElapsed = false;
  let quietGeneration: object = Object.freeze({});

  const clearTimer = (timer: ClockTimer | undefined): void => {
    if (timer === undefined) return;
    try {
      clock.clearTimeout(timer);
    } catch {
      // A timer adapter cannot alter already classified release evidence.
    }
  };

  const cleanup = (): void => {
    unsubscribePending = true;
    quietGeneration = Object.freeze({});
    abortArmSnapshot?.();
    abortArmSnapshot = undefined;
    clearTimer(deadlineTimer);
    deadlineTimer = undefined;
    clearTimer(quietTimer);
    quietTimer = undefined;
    clearTimer(pollTimer);
    pollTimer = undefined;
    if (unsubscribeChanges) {
      const unsubscribe = unsubscribeChanges;
      unsubscribeChanges = undefined;
      try {
        unsubscribe();
      } catch {
        // Browser listener teardown remains locally contained.
      }
    }
  };

  const finish = (outcome: HidReleaseOutcome): void => {
    if (terminalOutcome !== undefined) return;
    terminalOutcome = outcome;
    cleanup();
    resolveWait?.(outcome);
  };

  const readMonotonicNow = (): number | undefined => {
    try {
      const now = clock.monotonicNow();
      if (
        !Number.isFinite(now) ||
        now < 0 ||
        (lastMonotonicNow !== undefined && now < lastMonotonicNow)
      ) {
        return undefined;
      }
      lastMonotonicNow = now;
      return now;
    } catch {
      return undefined;
    }
  };

  const addDuration = (now: number, durationMs: number): number | undefined => {
    const target = now + durationMs;
    return Number.isFinite(target) && target > now ? target : undefined;
  };

  const deadlineElapsedAt = (now: number): boolean =>
    deadlineAt !== undefined && now >= deadlineAt;

  const finishReleasedAt = (now: number): void => {
    if (deadlineAt === undefined) {
      finish("unavailable");
    } else if (deadlineElapsedAt(now)) {
      finish("timed-out");
    } else {
      finish("released");
    }
  };

  const scheduleQuietTimer: (
    generation: object,
    delayMs: number,
  ) => void = (generation, delayMs) => {
    if (terminalOutcome !== undefined || generation !== quietGeneration) return;

    try {
      let scheduling = true;
      let firedSynchronously = false;
      const scheduledTimer = clock.setTimeout(() => {
        if (scheduling) {
          firedSynchronously = true;
          return;
        }
        if (
          terminalOutcome !== undefined ||
          generation !== quietGeneration
        ) {
          return;
        }
        quietTimer = undefined;
        const now = readMonotonicNow();
        if (now === undefined) {
          finish("unavailable");
          return;
        }
        if (deadlineElapsedAt(now)) {
          finish("timed-out");
          return;
        }
        if (quietDeadlineAt === undefined) {
          finish("unavailable");
          return;
        }
        const remainingMs = quietDeadlineAt - now;
        if (remainingMs > 0) {
          scheduleQuietTimer(generation, remainingMs);
          return;
        }
        quietPeriodElapsed = true;
      }, delayMs);
      scheduling = false;
      if (firedSynchronously) {
        clearTimer(scheduledTimer);
        finish("unavailable");
      } else if (terminalOutcome !== undefined) {
        clearTimer(scheduledTimer);
      } else {
        quietTimer = scheduledTimer;
      }
    } catch {
      finish("unavailable");
    }
  };

  const observeCandidateAbsentAt = (now: number, forceReset: boolean): void => {
    if (terminalOutcome !== undefined) return;
    if (deadlineElapsedAt(now)) {
      finish("timed-out");
      return;
    }
    if (candidateObservedAbsent && !forceReset) return;

    const target = addDuration(now, policy.reconnectQuietPeriodMs);
    if (target === undefined) {
      finish("unavailable");
      return;
    }
    candidateObservedAbsent = true;
    quietPeriodElapsed = false;
    quietDeadlineAt = target;
    quietGeneration = Object.freeze({});
    const generation = quietGeneration;
    clearTimer(quietTimer);
    quietTimer = undefined;
    scheduleQuietTimer(generation, policy.reconnectQuietPeriodMs);
  };

  const observeCandidatePresent = (): void => {
    candidateObservedAbsent = false;
    quietPeriodElapsed = false;
    quietDeadlineAt = undefined;
    quietGeneration = Object.freeze({});
    clearTimer(quietTimer);
    quietTimer = undefined;
  };

  const onDeviceChange = (change: HidDeviceChange): void => {
    if (terminalOutcome !== undefined) return;
    if (change.type === "unavailable") {
      finish("unavailable");
      return;
    }
    if (!uniqueCandidate) {
      finish("unavailable");
      return;
    }
    const inspection = inspectMatchingSnapshots(
      Object.freeze([change.device]),
      uniqueCandidate,
    );
    if (inspection.status === "unavailable") {
      finish("unavailable");
      return;
    }
    if (
      inspection.hasUnknownIdentity ||
      inspection.hasUnexpectedOpenedPeer
    ) {
      finish("ambiguous");
      return;
    }
    if (!inspection.hasMatchingDevice) return;
    if (change.type === "connect") {
      // WebHID's pending actor can bind any device with this model/product.
      finish("ambiguous");
      return;
    }
    if (!inspection.candidate) return;
    const now = readMonotonicNow();
    if (now === undefined) {
      finish("unavailable");
      return;
    }
    observeCandidateAbsentAt(now, true);
  };

  const readArmSnapshot = (): Promise<
    readonly HidDeviceSnapshot[] | undefined
  > =>
    new Promise((resolve) => {
      let settled = false;
      let timeout: ClockTimer | undefined;
      const settle = (
        snapshots: readonly HidDeviceSnapshot[] | undefined,
      ): void => {
        if (settled) return;
        settled = true;
        clearTimer(timeout);
        timeout = undefined;
        abortArmSnapshot = undefined;
        resolve(snapshots);
      };

      abortArmSnapshot = () => settle(undefined);
      try {
        const scheduledTimer = clock.setTimeout(
          () => settle(undefined),
          policy.snapshotTimeoutMs,
        );
        if (settled) {
          clearTimer(scheduledTimer);
        } else {
          timeout = scheduledTimer;
        }
      } catch {
        settle(undefined);
        return;
      }
      if (settled) return;

      let request: Promise<readonly HidDeviceSnapshot[]>;
      try {
        request = hidPort.getGrantedDevices();
      } catch {
        settle(undefined);
        return;
      }
      void Promise.resolve(request).then(
        (snapshots) => settle(snapshots),
        () => settle(undefined),
      );
    });

  const runArm = async (): Promise<void> => {
    if (!uniqueCandidate || terminalOutcome !== undefined) return;

    try {
      const unsubscribe = hidPort.subscribeToDeviceChanges(onDeviceChange);
      if (typeof unsubscribe !== "function") {
        finish("unavailable");
        return;
      }
      unsubscribeChanges = unsubscribe;
      if (unsubscribePending) cleanup();
    } catch {
      finish("unavailable");
      return;
    }
    if (terminalOutcome !== undefined) return;

    const snapshots = await readArmSnapshot();
    if (terminalOutcome !== undefined) return;
    if (!snapshots) {
      finish("unavailable");
      return;
    }

    const inspection = inspectMatchingSnapshots(snapshots, uniqueCandidate);
    if (inspection.status === "unavailable") {
      finish("unavailable");
      return;
    }
    if (
      inspection.hasUnknownIdentity ||
      inspection.hasUnexpectedOpenedPeer
    ) {
      finish("ambiguous");
      return;
    }
    if (inspection.candidate) {
      observeCandidatePresent();
      return;
    }
    const now = readMonotonicNow();
    if (now === undefined) {
      finish("unavailable");
      return;
    }
    observeCandidateAbsentAt(now, false);
  };

  const arm = (): Promise<void> => {
    if (armPromise) return armPromise;

    let resolveArm!: () => void;
    armPromise = new Promise<void>((resolve) => {
      resolveArm = resolve;
    });
    void runArm().then(resolveArm, () => {
      finish("unavailable");
      resolveArm();
    });
    return armPromise;
  };

  const schedulePoll = (poll: () => void): void => {
    if (
      terminalOutcome !== undefined ||
      pollTimer !== undefined ||
      pollInFlight
    ) {
      return;
    }
    try {
      let scheduling = true;
      let firedSynchronously = false;
      const scheduledTimer = clock.setTimeout(() => {
        if (scheduling) {
          firedSynchronously = true;
          return;
        }
        pollTimer = undefined;
        poll();
      }, policy.pollIntervalMs);
      scheduling = false;
      if (firedSynchronously) {
        clearTimer(scheduledTimer);
        finish("unavailable");
      } else if (terminalOutcome !== undefined) {
        clearTimer(scheduledTimer);
      } else {
        pollTimer = scheduledTimer;
      }
    } catch {
      finish("unavailable");
    }
  };

  const scheduleDeadlineTimer: (delayMs: number) => void = (delayMs) => {
    if (terminalOutcome !== undefined) return;
    try {
      let scheduling = true;
      let firedSynchronously = false;
      const scheduledTimer = clock.setTimeout(() => {
        if (scheduling) {
          firedSynchronously = true;
          return;
        }
        if (terminalOutcome !== undefined) return;
        deadlineTimer = undefined;
        const now = readMonotonicNow();
        if (now === undefined || deadlineAt === undefined) {
          finish("unavailable");
          return;
        }
        const remainingMs = deadlineAt - now;
        if (remainingMs > 0) {
          scheduleDeadlineTimer(remainingMs);
        } else {
          finish("timed-out");
        }
      }, delayMs);
      scheduling = false;
      if (firedSynchronously) {
        clearTimer(scheduledTimer);
        finish("unavailable");
      } else if (terminalOutcome !== undefined) {
        clearTimer(scheduledTimer);
      } else {
        deadlineTimer = scheduledTimer;
      }
    } catch {
      finish("unavailable");
    }
  };

  const runWait = async (): Promise<void> => {
    if (terminalOutcome !== undefined) {
      cleanup();
      resolveWait?.(terminalOutcome);
      return;
    }
    if (!uniqueCandidate) {
      finish("unavailable");
      return;
    }

    const startedAt = readMonotonicNow();
    if (startedAt === undefined) {
      finish("unavailable");
      return;
    }
    deadlineAt = addDuration(startedAt, policy.releaseDeadlineMs);
    if (deadlineAt === undefined) {
      finish("unavailable");
      return;
    }
    scheduleDeadlineTimer(policy.releaseDeadlineMs);
    if (terminalOutcome !== undefined) return;

    await arm();
    if (terminalOutcome !== undefined) return;

    const poll = async (): Promise<void> => {
      if (terminalOutcome !== undefined || pollInFlight) return;
      const beforeRead = readMonotonicNow();
      if (beforeRead === undefined) {
        finish("unavailable");
        return;
      }
      if (deadlineElapsedAt(beforeRead)) {
        finish("timed-out");
        return;
      }

      pollInFlight = true;
      let snapshots: readonly HidDeviceSnapshot[];
      try {
        snapshots = await hidPort.getGrantedDevices();
      } catch {
        pollInFlight = false;
        if (terminalOutcome === undefined) finish("unavailable");
        return;
      }
      pollInFlight = false;
      if (terminalOutcome !== undefined) return;

      const now = readMonotonicNow();
      if (now === undefined) {
        finish("unavailable");
        return;
      }
      if (deadlineElapsedAt(now)) {
        finish("timed-out");
        return;
      }

      const inspection = inspectMatchingSnapshots(snapshots, uniqueCandidate);
      if (inspection.status === "unavailable") {
        finish("unavailable");
        return;
      }
      const observedAt = readMonotonicNow();
      if (observedAt === undefined) {
        finish("unavailable");
        return;
      }
      if (deadlineElapsedAt(observedAt)) {
        finish("timed-out");
        return;
      }
      if (
        inspection.hasUnknownIdentity ||
        inspection.hasUnexpectedOpenedPeer
      ) {
        finish("ambiguous");
        return;
      }
      if (inspection.candidate?.opened === true) {
        observeCandidatePresent();
        schedulePoll(() => void poll());
        return;
      }

      if (inspection.candidate !== undefined) {
        observeCandidatePresent();
        finishReleasedAt(observedAt);
        return;
      }

      observeCandidateAbsentAt(observedAt, false);
      if (terminalOutcome !== undefined) return;
      if (
        quietDeadlineAt !== undefined &&
        (quietPeriodElapsed || observedAt >= quietDeadlineAt)
      ) {
        finishReleasedAt(observedAt);
        return;
      }
      schedulePoll(() => void poll());
    };

    void poll();
  };

  const wait = (): Promise<HidReleaseOutcome> => {
    if (waitPromise) return waitPromise;

    waitPromise = new Promise<HidReleaseOutcome>((resolve) => {
      resolveWait = resolve;
    });
    void runWait().catch(() => finish("unavailable"));
    return waitPromise;
  };

  const cancel = (): void => {
    if (terminalOutcome === undefined) {
      finish("unavailable");
    } else {
      cleanup();
      resolveWait?.(terminalOutcome);
    }
  };

  return Object.freeze({ arm, wait, cancel });
}
