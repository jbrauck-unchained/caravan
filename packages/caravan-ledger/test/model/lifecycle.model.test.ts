import { BitcoinInstallerError } from "../../src/errors";
import type {
  BitcoinInstallerEvent,
  BitcoinInstallerPhase,
} from "../../src/events";
import { createBitcoinAppInstallerCore } from "../../src/installer";
import { systemClock } from "../../src/internal/clock";
import type {
  DmkDiscoveredDevice,
  DmkSession,
} from "../../src/internal/dmkPort";
import {
  HidPortUnavailableError,
  LEDGER_HID_VENDOR_ID,
  type HidDeviceChange,
  type HidDeviceIdentity,
  type HidDeviceSnapshot,
  type HidPort,
} from "../../src/internal/hidPort";
import type { RuntimeLease } from "../../src/internal/runtimeLease";
import { createCandidateModelPolicyForTesting } from "../../src/internal/supportedModels";
import {
  ScriptedDmk,
  type ScriptedDmkCall,
} from "../../src/internal/testing/scriptedDmk";
import type {
  BitcoinAppInstaller,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "../../src/types";

type Profile = "bitcoin-missing" | "bitcoin-present";

type Command =
  | "action-tick"
  | "cancel"
  | "dispose"
  | "hid-close"
  | "hid-unavailable"
  | "install"
  | "late-emission"
  | "prepare"
  | "recover";

type ModelMode =
  | "idle"
  | "preparing"
  | "plan"
  | "installing"
  | "opening"
  | "releasing"
  | "ready"
  | "needs-recovery"
  | "cancelled"
  | "disposed";

type HidState = "none" | "closed" | "open" | "unavailable";
type TerminalIntent = "ready" | "needs-recovery" | "cancelled" | "disposed";

type PromiseExpectation =
  | { readonly state: "pending" }
  | {
      readonly state: "fulfilled";
      readonly status: BitcoinInstallPlan["status"];
    }
  | {
      readonly state: "install-fulfilled";
      readonly status: BitcoinInstallResult["status"];
      readonly appOpen: boolean;
      readonly handoff: BitcoinInstallResult["handoff"];
    }
  | {
      readonly state: "rejected";
      readonly code: BitcoinInstallerError["code"];
    };

interface ModelState {
  readonly profile: Profile;
  mode: ModelMode;
  visiblePhase: BitcoinInstallerPhase;
  hid: HidState;
  terminalIntent?: TerminalIntent;
  terminalError?: BitcoinInstallerError["code"];
  planAvailable: boolean;
  appOpen: boolean;
  attempts: number;
  consumedPlans: number;
  mutationDispatches: number;
  prepareOutcomes: PromiseExpectation[];
  installOutcomes: PromiseExpectation[];
}

interface PromiseProbe<T> {
  state: "pending" | "fulfilled" | "rejected";
  settlements: number;
  value?: T;
  error?: unknown;
}

interface TaggedEvent {
  readonly attempt: number;
  readonly event: BitcoinInstallerEvent;
}

const COMMANDS: readonly Command[] = Object.freeze([
  "action-tick",
  "cancel",
  "dispose",
  "hid-close",
  "hid-unavailable",
  "install",
  "late-emission",
  "prepare",
  "recover",
]);

const PUBLIC_COMMANDS: readonly Command[] = Object.freeze([
  "prepare",
  "recover",
  "install",
]);

const ACTION_TICK_MS = 30;
const HID_POLL_MS = 100;
const MAX_GENERATED_DEPTH = 6;
const MAX_TRACE_LENGTH = 8;
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

const PHASE_RANK: Readonly<Record<BitcoinInstallerPhase, number>> = {
  idle: 0,
  "selecting-device": 1,
  connecting: 2,
  "checking-genuine": 3,
  "checking-bitcoin-app": 4,
  "ready-to-install": 5,
  installing: 6,
  verifying: 7,
  "opening-bitcoin": 8,
  "releasing-device": 9,
  "ready-for-webusb": 10,
  "needs-recovery": 10,
  cancelled: 10,
  failed: 10,
  disposed: 11,
};

function initialModel(profile: Profile): ModelState {
  return {
    profile,
    mode: "idle",
    visiblePhase: "idle",
    hid: "none",
    planAvailable: false,
    appOpen: true,
    attempts: 0,
    consumedPlans: 0,
    mutationDispatches: 0,
    prepareOutcomes: [],
    installOutcomes: [],
  };
}

function copyModel(state: ModelState): ModelState {
  return {
    ...state,
    prepareOutcomes: [...state.prepareOutcomes],
    installOutcomes: [...state.installOutcomes],
  };
}

function replaceLastPending(
  outcomes: PromiseExpectation[],
  outcome: PromiseExpectation,
): void {
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (outcomes[index].state === "pending") {
      outcomes[index] = outcome;
      return;
    }
  }
}

function isPublicCallLegal(state: ModelState, command: Command): boolean {
  if (state.terminalIntent || state.mode === "disposed") return false;
  switch (command) {
    case "prepare":
      return state.mode === "idle" || state.mode === "cancelled";
    case "recover":
      return state.mode === "needs-recovery";
    case "install":
      return state.mode === "plan" && state.planAvailable;
    case "action-tick":
    case "cancel":
    case "dispose":
    case "hid-close":
    case "hid-unavailable":
    case "late-emission":
      return false;
  }
}

function startPreparation(state: ModelState): void {
  state.mode = "preparing";
  state.visiblePhase = "selecting-device";
  state.hid = "closed";
  state.planAvailable = false;
  state.attempts += 1;
  state.prepareOutcomes.push({ state: "pending" });
}

function settleTerminal(state: ModelState): void {
  const terminal = state.terminalIntent;
  if (!terminal) return;

  state.planAvailable = false;
  switch (terminal) {
    case "ready": {
      state.mode = "ready";
      state.visiblePhase = "ready-for-webusb";
      replaceLastPending(state.installOutcomes, {
        state: "install-fulfilled",
        status:
          state.profile === "bitcoin-missing"
            ? "installed"
            : "already-installed",
        appOpen: state.appOpen,
        handoff: state.hid === "closed" ? "ready" : "reconnect-required",
      });
      break;
    }
    case "needs-recovery":
      state.mode = "needs-recovery";
      state.visiblePhase = "needs-recovery";
      replaceLastPending(state.installOutcomes, {
        state: "rejected",
        code: state.terminalError ?? "state-unknown",
      });
      break;
    case "cancelled":
      state.mode = "cancelled";
      state.visiblePhase = "cancelled";
      replaceLastPending(state.prepareOutcomes, {
        state: "rejected",
        code: "cancelled",
      });
      replaceLastPending(state.installOutcomes, {
        state: "rejected",
        code: state.terminalError ?? "cancelled",
      });
      break;
    case "disposed":
      state.mode = "disposed";
      state.visiblePhase = "disposed";
      replaceLastPending(state.prepareOutcomes, {
        state: "rejected",
        code: "cancelled",
      });
      replaceLastPending(state.installOutcomes, {
        state: "rejected",
        code: state.terminalError ?? "cancelled",
      });
      break;
  }
  state.hid = "none";
  state.terminalIntent = undefined;
  state.terminalError = undefined;
}

function beginTerminal(
  state: ModelState,
  terminal: TerminalIntent,
  error?: BitcoinInstallerError["code"],
): void {
  state.terminalIntent = terminal;
  state.terminalError ??= error;
  state.planAvailable = false;
  const hasConnectedSession =
    state.mode === "plan" ||
    state.mode === "installing" ||
    state.mode === "opening" ||
    state.mode === "releasing";
  if (!hasConnectedSession || state.hid !== "open") settleTerminal(state);
}

function advanceScheduledActions(state: ModelState): void {
  if (state.terminalIntent) return;
  if (state.mode === "preparing") {
    state.mode = "plan";
    state.visiblePhase = "ready-to-install";
    state.planAvailable = true;
    if (state.hid !== "unavailable") state.hid = "open";
    replaceLastPending(state.prepareOutcomes, {
      state: "fulfilled",
      status:
        state.profile === "bitcoin-missing"
          ? "installation-required"
          : "already-installed",
    });
  } else if (state.mode === "installing" || state.mode === "opening") {
    state.mode = "releasing";
    state.visiblePhase = "releasing-device";
    beginTerminal(state, "ready");
  }
}

/** Pure legal model. Timed commands stand in for bounded SDK/HID settlements. */
function advanceModel(current: ModelState, command: Command): ModelState {
  const state = copyModel(current);
  if (state.mode === "disposed") return state;

  switch (command) {
    case "prepare":
    case "recover":
      if (isPublicCallLegal(state, command)) startPreparation(state);
      return state;
    case "install":
      if (!isPublicCallLegal(state, command)) return state;
      state.planAvailable = false;
      state.consumedPlans += 1;
      state.installOutcomes.push({ state: "pending" });
      if (state.profile === "bitcoin-missing") {
        state.mode = "installing";
        state.visiblePhase = "installing";
        state.mutationDispatches += 1;
      } else {
        state.mode = "opening";
        state.visiblePhase = "opening-bitcoin";
      }
      return state;
    case "action-tick":
      advanceScheduledActions(state);
      return state;
    case "cancel":
      if (state.terminalIntent) return state;
      switch (state.mode) {
        case "preparing":
        case "plan":
          beginTerminal(state, "cancelled", "cancelled");
          return state;
        case "installing":
          beginTerminal(state, "needs-recovery", "state-unknown");
          return state;
        case "opening":
          state.appOpen = false;
          state.mode = "releasing";
          state.visiblePhase = "releasing-device";
          beginTerminal(state, "ready");
          return state;
        case "idle":
        case "releasing":
        case "ready":
        case "needs-recovery":
        case "cancelled":
          return state;
      }
      return state;
    case "dispose":
      if (state.terminalIntent) {
        state.terminalIntent = "disposed";
        state.terminalError ??=
          state.mode === "installing" ? "state-unknown" : "cancelled";
        if (state.hid !== "open") settleTerminal(state);
        return state;
      }
      if (
        state.mode === "idle" ||
        state.mode === "preparing" ||
        state.mode === "ready" ||
        state.mode === "needs-recovery" ||
        state.mode === "cancelled"
      ) {
        beginTerminal(state, "disposed", "cancelled");
        return state;
      }
      beginTerminal(
        state,
        "disposed",
        state.mode === "installing" ? "state-unknown" : "cancelled",
      );
      return state;
    case "hid-close":
      if (state.hid !== "none" && state.hid !== "unavailable") {
        state.hid = "closed";
      }
      if (state.terminalIntent) {
        settleTerminal(state);
      } else {
        // The harness advances one HID poll interval after closing. That same
        // deterministic time window can also settle the short SDK scripts.
        advanceScheduledActions(state);
      }
      return state;
    case "hid-unavailable":
      if (state.hid !== "none") state.hid = "unavailable";
      if (state.terminalIntent) settleTerminal(state);
      return state;
    case "late-emission":
      return state;
  }
}

function modelFingerprint(state: ModelState): string {
  return [
    state.mode,
    state.visiblePhase,
    state.hid,
    state.terminalIntent ?? "none",
    state.terminalError ?? "none",
    state.planAvailable ? "plan" : "no-plan",
    state.appOpen ? "opened" : "not-opened",
    `attempts:${state.attempts}`,
    `consumed:${state.consumedPlans}`,
    `mutations:${state.mutationDispatches}`,
  ].join("|");
}

function compareTraces(
  left: readonly Command[],
  right: readonly Command[],
): number {
  return left.join("\u0000").localeCompare(right.join("\u0000"));
}

function canReceiveLateEmission(state: ModelState): boolean {
  return (
    state.terminalIntent !== undefined ||
    state.mode === "ready" ||
    state.mode === "needs-recovery" ||
    state.mode === "cancelled" ||
    state.mode === "disposed"
  );
}

/**
 * This explores one lexicographically smallest representative per abstract
 * state, plus every one-command probe from each representative. Keeping the
 * probes is important: invalid/replayed public calls and idempotent lifecycle
 * commands commonly leave the reference state unchanged, but still have to be
 * exercised against the implementation. A late-emission probe is meaningful
 * only once terminal cleanup is underway or complete; before then it would
 * merely duplicate action-tick under the fake clock.
 */
function generateBoundedTraces(profile: Profile): readonly Command[][] {
  const initial = initialModel(profile);
  const seen = new Set([modelFingerprint(initial)]);
  const representatives: Command[][] = [[]];
  const commandProbes: Command[][] = [];
  let frontier: Array<{
    readonly trace: Command[];
    readonly state: ModelState;
  }> = [{ trace: [], state: initial }];

  for (let depth = 0; depth < MAX_GENERATED_DEPTH; depth += 1) {
    const nextFrontier: typeof frontier = [];
    for (const entry of frontier) {
      for (const command of COMMANDS) {
        if (
          command === "late-emission" &&
          !canReceiveLateEmission(entry.state)
        ) {
          continue;
        }
        const trace = [...entry.trace, command];
        commandProbes.push(trace);
        const nextState = advanceModel(entry.state, command);
        const fingerprint = modelFingerprint(nextState);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        representatives.push(trace);
        nextFrontier.push({ trace, state: nextState });
      }
    }
    frontier = nextFrontier;
  }

  const mandatory: readonly Command[][] = [
    ["prepare", "action-tick", "hid-close", "install", "action-tick"],
    ["prepare", "action-tick", "install", "action-tick", "hid-unavailable"],
    ["prepare", "cancel", "late-emission", "prepare", "action-tick"],
    [
      "prepare",
      "action-tick",
      "install",
      "dispose",
      "late-emission",
      "hid-unavailable",
      "prepare",
    ],
    [
      "prepare",
      "action-tick",
      "install",
      "cancel",
      "late-emission",
      "hid-unavailable",
      "recover",
      "action-tick",
    ],
  ];

  const byKey = new Map<string, Command[]>();
  for (const trace of [...representatives, ...commandProbes, ...mandatory]) {
    if (trace.length === 0 || trace.length > MAX_TRACE_LENGTH) continue;
    byKey.set(trace.join("\u0000"), trace);
  }
  return [...byKey.values()].sort(compareTraces);
}

function formatTrace(trace: readonly Command[]): string {
  return trace.length === 0 ? "<empty>" : trace.join(" -> ");
}

function minimizeFailingTrace(
  trace: readonly Command[],
  stillFails: (candidate: readonly Command[]) => boolean,
): readonly Command[] {
  let result = [...trace];
  let index = 0;
  while (index < result.length) {
    const candidate = result.filter(
      (_, candidateIndex) => candidateIndex !== index,
    );
    if (stillFails(candidate)) {
      result = candidate;
    } else {
      index += 1;
    }
  }
  return result;
}

async function minimizeFailingTraceAsync(
  trace: readonly Command[],
  stillFails: (candidate: readonly Command[]) => Promise<boolean>,
): Promise<readonly Command[]> {
  let result = [...trace];
  let index = 0;
  while (index < result.length) {
    const candidate = result.filter(
      (_, candidateIndex) => candidateIndex !== index,
    );
    if (await stillFails(candidate)) {
      result = candidate;
    } else {
      index += 1;
    }
  }
  return result;
}

function containsIllegalPublicCall(trace: readonly Command[]): boolean {
  let state = initialModel("bitcoin-missing");
  for (const command of trace) {
    if (
      PUBLIC_COMMANDS.includes(command) &&
      !isPublicCallLegal(state, command)
    ) {
      return true;
    }
    state = advanceModel(state, command);
  }
  return false;
}

function probePromise<T>(promise: Promise<T>): PromiseProbe<T> {
  const probe: PromiseProbe<T> = { state: "pending", settlements: 0 };
  void promise.then(
    (value) => {
      probe.state = "fulfilled";
      probe.value = value;
      probe.settlements += 1;
    },
    (error: unknown) => {
      probe.state = "rejected";
      probe.error = error;
      probe.settlements += 1;
    },
  );
  return probe;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
}

class LeaseLedger {
  active = 0;
  maximumActive = 0;
  acquisitions = 0;
  releases = 0;
  private generation = 0;

  readonly acquire = (): RuntimeLease => {
    this.acquisitions += 1;
    this.generation += 1;
    const generation = this.generation;
    let valid = true;
    let released = false;
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);

    return Object.freeze({
      generation,
      isCurrent: () => valid && !released,
      invalidate: () => {
        valid = false;
      },
      release: () => {
        if (released) return;
        released = true;
        valid = false;
        this.active -= 1;
        this.releases += 1;
      },
    });
  };
}

class ModelHidPort implements HidPort {
  readonly #identity = Object.freeze({}) as HidDeviceIdentity;
  readonly #listeners = new Set<(change: HidDeviceChange) => void>();
  #opened = false;
  #everOpened = false;
  #unavailable = false;
  releaseObserved = false;

  get activeListeners(): number {
    return this.#listeners.size;
  }

  markOpened(): void {
    this.#opened = true;
    this.#everOpened = true;
  }

  markClosed(): void {
    this.#opened = false;
  }

  makeUnavailable(): void {
    this.#unavailable = true;
    for (const listener of [...this.#listeners])
      listener({ type: "unavailable" });
  }

  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]> {
    if (this.#unavailable) return Promise.reject(new HidPortUnavailableError());
    if (this.#everOpened && !this.#opened) this.releaseObserved = true;
    const snapshot: HidDeviceSnapshot = Object.freeze({
      identity: this.#identity,
      vendorId: LEDGER_HID_VENDOR_ID,
      productId: 0x1000,
      opened: this.#opened,
    });
    return Promise.resolve(Object.freeze([snapshot]));
  }

  subscribeToDeviceChanges(
    listener: (change: HidDeviceChange) => void,
  ): () => void {
    if (this.#unavailable) {
      listener({ type: "unavailable" });
      return () => undefined;
    }
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }
}

const discoveredDevice: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "model-device",
});

class InstrumentedScriptedDmk extends ScriptedDmk {
  readonly hid = new ModelHidPort();
  connected = false;

  constructor(
    readonly profile: Profile,
    private readonly onSessionDelta: (delta: 1 | -1) => void,
  ) {
    super(systemClock);
    const session: DmkSession = Object.freeze({
      internalSessionId: "model-session",
      modelId: "nanoS",
    });
    const bitcoinPresent = profile === "bitcoin-present";
    this.queueDiscovery([
      {
        type: "next",
        value: discoveredDevice,
        atMs: 1,
        afterCancel: true,
      },
    ])
      .queueConnect({ type: "resolve", value: session, afterMs: 1 })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: { status: "completed", output: { isGenuine: true } },
          atMs: 1,
          afterCancel: true,
        },
      ])
      .queueAction("list-bitcoin", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent },
          },
          atMs: 1,
          afterCancel: true,
        },
      ]);

    if (profile === "bitcoin-missing") {
      this.queueAction("install-bitcoin", [
        { type: "attempt-install-mutation" },
        {
          type: "next",
          value: {
            status: "pending",
            interaction: "confirm-install",
            progress: 0.5,
          },
        },
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
          atMs: 5,
          afterCancel: true,
        },
      ]).queueAction("list-bitcoin", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
          atMs: 1,
          afterCancel: true,
        },
      ]);
    }

    this.queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
        atMs: 5,
        afterCancel: true,
      },
    ]);
  }

  override connect(device: DmkDiscoveredDevice): Promise<DmkSession> {
    return super.connect(device).then((session) => {
      if (!this.connected) {
        this.connected = true;
        this.onSessionDelta(1);
      }
      this.hid.markOpened();
      return session;
    });
  }

  override disconnect(session: DmkSession): Promise<void> {
    const finish = (): void => {
      if (!this.connected) return;
      this.connected = false;
      this.onSessionDelta(-1);
    };
    return super.disconnect(session).then(
      () => finish(),
      (error: unknown) => {
        finish();
        throw error;
      },
    );
  }
}

function actionKinds(fake: ScriptedDmk): string[] {
  return fake.calls
    .filter((call) => call.type === "run-action")
    .map((call) => call.action?.kind ?? "missing");
}

function assertAtMostOneActiveBoundary(
  calls: readonly ScriptedDmkCall[],
): void {
  const activeDiscovery = new Set<number>();
  const activeAction = new Set<number>();
  for (const call of calls) {
    const operationId = call.operationId;
    if (operationId === undefined) continue;
    const active = call.source === "discovery" ? activeDiscovery : activeAction;
    if (call.source !== "discovery" && call.source !== "action") continue;
    if (call.type === "subscribe") active.add(operationId);
    if (
      call.type === "unsubscribe" ||
      call.type === "complete" ||
      call.type === "stream-error"
    ) {
      active.delete(operationId);
    }
    expect(activeDiscovery.size).toBeLessThanOrEqual(1);
    expect(activeAction.size).toBeLessThanOrEqual(1);
  }
}

function expectedActionPrefix(profile: Profile): readonly string[] {
  return profile === "bitcoin-missing"
    ? [
        "genuine",
        "list-bitcoin",
        "install-bitcoin",
        "list-bitcoin",
        "open-bitcoin",
      ]
    : ["genuine", "list-bitcoin", "open-bitcoin"];
}

class LifecycleHarness {
  readonly lease = new LeaseLedger();
  readonly attempts: InstrumentedScriptedDmk[] = [];
  readonly events: TaggedEvent[] = [];
  readonly prepareProbes: Array<PromiseProbe<BitcoinInstallPlan>> = [];
  readonly installProbes: Array<PromiseProbe<BitcoinInstallResult>> = [];
  readonly invalidProbes: Array<PromiseProbe<unknown>> = [];
  readonly installer: BitcoinAppInstaller;
  model: ModelState;
  activeSessions = 0;
  maximumSessions = 0;
  private currentAttempt = -1;
  private currentPlan: BitcoinInstallPlan | undefined;
  private lastPlan: BitcoinInstallPlan | undefined;
  private disposePromise: Promise<void> | undefined;
  private disposeProbe: PromiseProbe<void> | undefined;

  constructor(readonly profile: Profile) {
    this.model = initialModel(profile);
    this.installer = createBitcoinAppInstallerCore({
      acquireLease: this.lease.acquire,
      clock: systemClock,
      createPort: () => {
        const attempt = new InstrumentedScriptedDmk(profile, (delta) => {
          this.activeSessions += delta;
          this.maximumSessions = Math.max(
            this.maximumSessions,
            this.activeSessions,
          );
        });
        this.attempts.push(attempt);
        this.currentAttempt = this.attempts.length - 1;
        return attempt;
      },
      createHidPort: () => {
        const attempt = this.attempts[this.currentAttempt];
        if (!attempt) throw new Error("No symbolic attempt owns the HID port.");
        return attempt.hid;
      },
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    this.installer.subscribe((event) => {
      this.events.push({ attempt: this.currentAttempt, event });
    });
  }

  async step(command: Command): Promise<void> {
    const before = this.model;
    const disposedSnapshot =
      before.mode === "disposed" ? this.absorptionSnapshot() : undefined;
    const lateEmissionSnapshot =
      command === "late-emission" && canReceiveLateEmission(before)
        ? this.absorptionSnapshot()
        : undefined;
    const legal = isPublicCallLegal(before, command);

    switch (command) {
      case "prepare": {
        const probe = probePromise(this.installer.prepare());
        (legal ? this.prepareProbes : this.invalidProbes).push(probe);
        break;
      }
      case "recover": {
        const probe = probePromise(this.installer.recover());
        (legal ? this.prepareProbes : this.invalidProbes).push(probe);
        break;
      }
      case "install": {
        const candidate =
          this.currentPlan ??
          this.lastPlan ??
          (Object.freeze({
            status: "installation-required",
          }) as unknown as BitcoinInstallPlan);
        const probe = probePromise(this.installer.install(candidate));
        (legal ? this.installProbes : this.invalidProbes).push(probe);
        break;
      }
      case "cancel":
        this.installer.cancel();
        break;
      case "dispose": {
        const disposal = this.installer.dispose();
        if (this.disposePromise) {
          expect(disposal).toBe(this.disposePromise);
        } else {
          this.disposePromise = disposal;
          this.disposeProbe = probePromise(disposal);
        }
        break;
      }
      case "hid-close":
        this.attempts.at(-1)?.hid.markClosed();
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(HID_POLL_MS);
        break;
      case "hid-unavailable":
        this.attempts.at(-1)?.hid.makeUnavailable();
        break;
      case "action-tick":
      case "late-emission":
        await vi.advanceTimersByTimeAsync(ACTION_TICK_MS);
        break;
    }

    this.model = advanceModel(before, command);
    await flushMicrotasks();
    this.refreshPlan();
    if (!this.model.planAvailable) this.currentPlan = undefined;

    // Scripted `afterCancel` timers model a vendor callback that violates
    // teardown. Drain it only after the package has reached a public terminal,
    // then prove it cannot revive the operation or retain resources.
    if (
      this.model.mode === "ready" ||
      this.model.mode === "needs-recovery" ||
      this.model.mode === "cancelled" ||
      this.model.mode === "disposed"
    ) {
      await vi.advanceTimersByTimeAsync(ACTION_TICK_MS);
      await flushMicrotasks();
    }

    this.assertMatchesModel();
    if (disposedSnapshot)
      expect(this.absorptionSnapshot()).toEqual(disposedSnapshot);
    if (lateEmissionSnapshot)
      expect(this.absorptionSnapshot()).toEqual(lateEmissionSnapshot);
  }

  async finish(): Promise<void> {
    await this.step("dispose");
    await this.step("hid-unavailable");
    await vi.advanceTimersByTimeAsync(ACTION_TICK_MS);
    await flushMicrotasks();
    this.assertMatchesModel();
    expect(this.disposeProbe?.state).toBe("fulfilled");
    expect(this.lease.active).toBe(0);
    expect(this.activeSessions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const attempt of this.attempts) {
      expect(attempt.resources().activeSubscriptions).toBe(0);
      expect(attempt.resources().scheduledTimers).toBe(0);
      expect(attempt.hid.activeListeners).toBe(0);
    }
    for (const probe of this.invalidProbes) {
      expect(probe.state).toBe("rejected");
      expect(probe.error).toBeInstanceOf(BitcoinInstallerError);
      expect(probe.settlements).toBe(1);
    }
  }

  private refreshPlan(): void {
    const probe = this.prepareProbes.at(-1);
    if (probe?.state !== "fulfilled" || !probe.value) return;
    this.currentPlan = probe.value;
    this.lastPlan = probe.value;
  }

  private absorptionSnapshot(): readonly number[] {
    const actionCount = this.attempts.reduce(
      (total, attempt) => total + attempt.resources().actionCount,
      0,
    );
    const mutations = this.attempts.reduce(
      (total, attempt) =>
        total +
        attempt.calls.filter((call) => call.type === "attempt-install-mutation")
          .length,
      0,
    );
    return [
      this.events.length,
      this.attempts.length,
      actionCount,
      mutations,
      this.lease.active,
      this.activeSessions,
    ];
  }

  private assertMatchesModel(): void {
    expect(this.events.at(-1)?.event.phase ?? "idle").toBe(
      this.model.visiblePhase,
    );
    expect(this.currentPlan !== undefined).toBe(this.model.planAvailable);
    expect(this.attempts).toHaveLength(this.model.attempts);
    expect(this.lease.releases).toBeLessThanOrEqual(this.lease.acquisitions);
    expect(this.lease.active).toBe(
      this.lease.acquisitions - this.lease.releases,
    );
    expect(this.lease.active).toBeLessThanOrEqual(1);
    expect(this.lease.maximumActive).toBeLessThanOrEqual(1);
    expect(this.activeSessions).toBeGreaterThanOrEqual(0);
    expect(this.activeSessions).toBeLessThanOrEqual(1);
    expect(this.maximumSessions).toBeLessThanOrEqual(1);

    this.assertPromiseOutcomes(this.prepareProbes, this.model.prepareOutcomes);
    this.assertPromiseOutcomes(this.installProbes, this.model.installOutcomes);
    for (const probe of [
      ...this.prepareProbes,
      ...this.installProbes,
      ...this.invalidProbes,
      ...(this.disposeProbe ? [this.disposeProbe] : []),
    ]) {
      expect(probe.settlements).toBeLessThanOrEqual(1);
    }
    for (const probe of this.invalidProbes)
      expect(probe.state).not.toBe("fulfilled");

    let installActions = 0;
    let mutationAttempts = 0;
    for (const attempt of this.attempts) {
      assertAtMostOneActiveBoundary(attempt.calls);
      const resources = attempt.resources();
      expect(resources.connectCount).toBeLessThanOrEqual(1);
      expect(resources.disconnectCount).toBeLessThanOrEqual(
        resources.connectCount,
      );
      expect(resources.closeCount).toBeLessThanOrEqual(resources.connectCount);
      const kinds = actionKinds(attempt);
      expect(kinds).toEqual(
        expectedActionPrefix(this.profile).slice(0, kinds.length),
      );
      installActions += kinds.filter(
        (kind) => kind === "install-bitcoin",
      ).length;
      mutationAttempts += attempt.calls.filter(
        (call) => call.type === "attempt-install-mutation",
      ).length;
    }
    expect(installActions).toBeLessThanOrEqual(this.model.consumedPlans);
    expect(mutationAttempts).toBe(this.model.mutationDispatches);
    expect(mutationAttempts).toBeLessThanOrEqual(this.model.consumedPlans);

    const eventsByAttempt = new Map<number, BitcoinInstallerPhase[]>();
    for (const tagged of this.events) {
      const phases = eventsByAttempt.get(tagged.attempt) ?? [];
      phases.push(tagged.event.phase);
      eventsByAttempt.set(tagged.attempt, phases);
    }
    for (const phases of eventsByAttempt.values()) {
      for (let index = 1; index < phases.length; index += 1) {
        expect(PHASE_RANK[phases[index]]).toBeGreaterThanOrEqual(
          PHASE_RANK[phases[index - 1]],
        );
      }
    }

    for (const probe of this.installProbes) {
      if (probe.state !== "fulfilled" || !probe.value) continue;
      if (probe.value.handoff === "ready") {
        expect(
          this.attempts.some((attempt) => attempt.hid.releaseObserved),
        ).toBe(true);
        expect(this.lease.active).toBe(0);
      }
    }

    if (
      this.model.mode === "ready" ||
      this.model.mode === "needs-recovery" ||
      this.model.mode === "cancelled" ||
      this.model.mode === "disposed"
    ) {
      expect(this.lease.active).toBe(0);
      expect(this.activeSessions).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      for (const attempt of this.attempts) {
        const resources = attempt.resources();
        expect(resources.activeSubscriptions).toBe(0);
        expect(resources.scheduledTimers).toBe(0);
        expect(resources.disconnectCount).toBe(resources.connectCount);
        expect(resources.closeCount).toBe(0);
        expect(attempt.hid.activeListeners).toBe(0);
      }
    }
  }

  private assertPromiseOutcomes<T>(
    probes: readonly PromiseProbe<T>[],
    expectations: readonly PromiseExpectation[],
  ): void {
    expect(probes).toHaveLength(expectations.length);
    for (let index = 0; index < expectations.length; index += 1) {
      const probe = probes[index];
      const expectation = expectations[index];
      switch (expectation.state) {
        case "pending":
          expect(probe.state).toBe("pending");
          break;
        case "fulfilled":
          expect(probe.state).toBe("fulfilled");
          expect(probe.value).toMatchObject({ status: expectation.status });
          break;
        case "install-fulfilled":
          expect(probe.state).toBe("fulfilled");
          expect(probe.value).toEqual({
            status: expectation.status,
            appOpen: expectation.appOpen,
            handoff: expectation.handoff,
          });
          break;
        case "rejected":
          expect(probe.state).toBe("rejected");
          expect(probe.error).toBeInstanceOf(BitcoinInstallerError);
          expect(probe.error).toMatchObject({ code: expectation.code });
          break;
      }
    }
  }
}

async function assertTrace(
  profile: Profile,
  trace: readonly Command[],
): Promise<void> {
  const harness = new LifecycleHarness(profile);
  try {
    for (const command of trace) await harness.step(command);
  } finally {
    await harness.finish();
  }
}

describe("bounded installer lifecycle model", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates a stable, lexically ordered, bounded abstraction", () => {
    expect(COMMANDS).toEqual([...COMMANDS].sort());
    for (const profile of ["bitcoin-missing", "bitcoin-present"] as const) {
      const traces = generateBoundedTraces(profile);
      expect(traces.length).toBeGreaterThan(100);
      expect(traces.length).toBeLessThan(1_000);
      expect(traces).toEqual([...traces].sort(compareTraces));
      expect(new Set(traces.map((trace) => formatTrace(trace))).size).toBe(
        traces.length,
      );
      expect(
        Math.max(...traces.map((trace) => trace.length)),
      ).toBeLessThanOrEqual(MAX_TRACE_LENGTH);
      expect(traces).toContainEqual([
        "prepare",
        "action-tick",
        "install",
        "install",
      ]);
      expect(traces.some((trace) => trace.includes("recover"))).toBe(true);
      expect(traces).toContainEqual(["dispose", "late-emission"]);
    }
  });

  it.each(["bitcoin-missing", "bitcoin-present"] as const)(
    "preserves lifecycle, authority, and cleanup invariants for %s",
    async (profile) => {
      for (const trace of generateBoundedTraces(profile)) {
        try {
          await assertTrace(profile, trace);
        } catch {
          const minimized = await minimizeFailingTraceAsync(
            trace,
            async (candidate) => {
              try {
                await assertTrace(profile, candidate);
                return false;
              } catch {
                return true;
              }
            },
          );
          throw new Error(
            `Lifecycle model mismatch: ${formatTrace(minimized)} (from ${formatTrace(trace)})`,
          );
        }
      }
    },
  );

  it("minimizes a deliberately illegal trace using symbolic steps only", () => {
    const noisy: readonly Command[] = [
      "action-tick",
      "late-emission",
      "install",
      "cancel",
    ];
    const minimized = minimizeFailingTrace(noisy, containsIllegalPublicCall);

    expect(minimized).toEqual(["install"]);
    expect(formatTrace(minimized)).toBe("install");
    expect(formatTrace(minimized)).not.toMatch(
      /device|session|payload|identifier/i,
    );
  });
});
