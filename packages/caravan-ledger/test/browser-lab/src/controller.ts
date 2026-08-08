import type {
  BitcoinAppInstaller,
  BitcoinInstallerEvent,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "@caravan/ledger";

export type BrowserLabPhase =
  | "idle"
  | "preparing"
  | "prepared"
  | "installing"
  | "ready"
  | "reconnect-required"
  | "cancelled"
  | "failed"
  | "disposed";

export interface BrowserLabSnapshot {
  readonly phase: BrowserLabPhase;
  readonly prepareEnabled: boolean;
  readonly cancelEnabled: boolean;
  readonly installEnabled: boolean;
  readonly continuationEnabled: boolean;
  readonly lastEvent?: BitcoinInstallerEvent;
}

export interface BrowserLabView {
  render(snapshot: BrowserLabSnapshot): void;
  renderEvent(event: BitcoinInstallerEvent): void;
}

type InstallerSurface = Pick<
  BitcoinAppInstaller,
  "cancel" | "dispose" | "install" | "prepare" | "subscribe"
>;

type WebUsbContinuation = () => void | Promise<void>;

const INITIAL_SNAPSHOT: BrowserLabSnapshot = Object.freeze({
  phase: "idle",
  prepareEnabled: true,
  cancelEnabled: false,
  installEnabled: false,
  continuationEnabled: false,
});

function isCancellation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  try {
    return Reflect.get(error, "code") === "cancelled";
  } catch {
    return false;
  }
}

/**
 * Private browser-lab orchestration. Test state stays here and never crosses
 * the package's public export boundary.
 */
export class BrowserLabController {
  #snapshot = INITIAL_SNAPSHOT;

  #plan: BitcoinInstallPlan | undefined;

  #operation: Promise<void> | undefined;

  #unsubscribe: (() => void) | undefined;

  constructor(
    private readonly installer: InstallerSurface,
    private readonly openWebUsb: WebUsbContinuation,
    private readonly view: BrowserLabView,
  ) {}

  get snapshot(): BrowserLabSnapshot {
    return this.#snapshot;
  }

  start(): void {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.installer.subscribe((event) => {
      this.view.renderEvent(event);
      this.#render({ lastEvent: event });
    });
    this.view.render(this.#snapshot);
  }

  /** Calls prepare synchronously in the caller's click task. */
  prepareFromClick(): Promise<void> {
    if (this.#operation) return this.#operation;

    this.#plan = undefined;
    this.#render({
      phase: "preparing",
      prepareEnabled: false,
      cancelEnabled: true,
      installEnabled: false,
      continuationEnabled: false,
    });

    let preparation: Promise<BitcoinInstallPlan>;
    try {
      preparation = this.installer.prepare();
    } catch (error) {
      this.#settleFailure(error);
      return Promise.resolve();
    }

    const operation = preparation
      .then((plan) => {
        this.#plan = plan;
        this.#render({
          phase: "prepared",
          prepareEnabled: false,
          cancelEnabled: false,
          installEnabled: true,
        });
      })
      .catch((error: unknown) => this.#settleFailure(error))
      .finally(() => {
        if (this.#operation === operation) this.#operation = undefined;
      });
    this.#operation = operation;
    return operation;
  }

  cancelFromClick(): void {
    if (!this.#operation) return;
    this.installer.cancel();
  }

  /** Calls install synchronously in the caller's distinct click task. */
  installFromClick(): Promise<void> {
    if (this.#operation || !this.#plan) {
      return this.#operation ?? Promise.resolve();
    }

    this.#render({
      phase: "installing",
      cancelEnabled: true,
      installEnabled: false,
      continuationEnabled: false,
    });

    let installation: Promise<BitcoinInstallResult>;
    try {
      installation = this.installer.install(this.#plan);
    } catch (error) {
      this.#settleFailure(error);
      return Promise.resolve();
    }

    const operation = installation
      .then((result) => this.acceptResult(result))
      .catch((error: unknown) => this.#settleFailure(error))
      .finally(() => {
        if (this.#operation === operation) this.#operation = undefined;
      });
    this.#operation = operation;
    return operation;
  }

  /** A settled result may enable a continuation, but never starts WebUSB. */
  acceptResult(result: BitcoinInstallResult): void {
    const ready = result.handoff === "ready";
    this.#render({
      phase: ready ? "ready" : "reconnect-required",
      prepareEnabled: false,
      cancelEnabled: false,
      installEnabled: false,
      continuationEnabled: ready,
    });
  }

  /** Calls the WebUSB seam only in this separate click entry point. */
  continueFromClick(): Promise<boolean> {
    if (!this.#snapshot.continuationEnabled) return Promise.resolve(false);

    this.#render({ continuationEnabled: false });
    try {
      return Promise.resolve(this.openWebUsb()).then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  async dispose(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.installer.dispose();
    this.#render({
      phase: "disposed",
      prepareEnabled: false,
      cancelEnabled: false,
      installEnabled: false,
      continuationEnabled: false,
    });
  }

  #settleFailure(error: unknown): void {
    const cancelled = isCancellation(error);
    this.#render({
      phase: cancelled ? "cancelled" : "failed",
      prepareEnabled: cancelled,
      cancelEnabled: false,
      installEnabled: false,
      continuationEnabled: false,
    });
  }

  #render(update: Partial<BrowserLabSnapshot>): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...update });
    this.view.render(this.#snapshot);
  }
}

/**
 * Deliberate anti-pattern: first loading code after a click crosses an async
 * boundary before prepare can run, so transient user activation is lost.
 */
export async function intentionallyLateDynamicImport<T>(
  load: () => Promise<T>,
  afterLoad: (loaded: T) => void | Promise<void>,
): Promise<void> {
  const loaded = await load();
  await afterLoad(loaded);
}
