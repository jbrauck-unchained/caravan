import type { BitcoinInstallerInteraction } from "../events";

export type DmkActionKind =
  | "genuine"
  | "list-bitcoin"
  | "install-bitcoin"
  | "open-bitcoin";

export type DmkActionRequest =
  | { readonly kind: "genuine" }
  | { readonly kind: "list-bitcoin" }
  | { readonly kind: "install-bitcoin" }
  | { readonly kind: "open-bitcoin" };

export interface DmkActionOutputByKind {
  readonly genuine: { readonly isGenuine: boolean };
  readonly "list-bitcoin": { readonly bitcoinPresent: boolean };
  readonly "install-bitcoin": { readonly actionCompleted: true };
  readonly "open-bitcoin": { readonly appOpened: boolean };
}

export type DmkActionState<K extends DmkActionKind = DmkActionKind> =
  | { readonly status: "not-started" }
  | {
      readonly status: "pending";
      readonly interaction?: BitcoinInstallerInteraction;
      readonly progress?: number;
    }
  | {
      readonly status: "completed";
      readonly output: DmkActionOutputByKind[K];
    }
  | { readonly status: "error"; readonly rawError: unknown }
  | { readonly status: "stopped" };

export interface DmkDiscoveredDevice {
  /** Runtime-only adapter identity. Never expose or persist this value. */
  readonly internalDeviceId: string;
  /** Untrusted discovery hint; absence must remain representable. */
  readonly modelId?: string;
}

export interface DmkSession {
  /** Runtime-only adapter capability. Never expose or persist this value. */
  readonly internalSessionId: string;
  /** Connected model evidence. Missing/unknown values must fail the model gate. */
  readonly modelId?: string;
}

export interface DmkObserver<T> {
  next(value: T): void;
  error(error: unknown): void;
  complete(): void;
}

export interface DmkSubscription {
  readonly closed: boolean;
  unsubscribe(): void;
}

export interface DmkStream<T> {
  subscribe(observer: DmkObserver<T>): DmkSubscription;
}

export interface DmkOperation<T> {
  readonly stream: DmkStream<T>;
  cancel(): void;
}

/**
 * Package-owned reduction of the Ledger runtime boundary.
 *
 * The only action authority is the closed Bitcoin-specific union above.
 */
export interface DmkPort {
  isEnvironmentSupported(): boolean;
  startDiscovery(): DmkOperation<DmkDiscoveredDevice>;
  connect(device: DmkDiscoveredDevice): Promise<DmkSession>;
  /**
   * Observe only the lifetime of a connected session. Native state values are
   * deliberately discarded; completion or error means the generation is no
   * longer usable.
   */
  observeSessionLifecycle(session: DmkSession): DmkStream<never>;
  runAction<K extends DmkActionKind>(
    session: DmkSession,
    action: Extract<DmkActionRequest, { readonly kind: K }>,
  ): DmkOperation<DmkActionState<K>>;
  disconnect(session: DmkSession): Promise<void>;
  close(): Promise<void>;
}
