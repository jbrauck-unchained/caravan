/// <reference types="vitest/globals" />

import React from "react";
import type {
  BitcoinAppInstaller,
  BitcoinInstallerErrorCode,
  BitcoinInstallerEvent,
  BitcoinInstallerPhase,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "@caravan/ledger";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../utils/test-utils";
import { BitcoinAppInstallerFlow } from "./BitcoinAppInstallerFlow";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface FakeInstaller extends BitcoinAppInstaller {
  readonly prepare: ReturnType<typeof vi.fn>;
  readonly install: ReturnType<typeof vi.fn>;
  readonly recover: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  emit(event: BitcoinInstallerEvent): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function plan(status: BitcoinInstallPlan["status"]): BitcoinInstallPlan {
  return Object.freeze({ status }) as unknown as BitcoinInstallPlan;
}

function result(
  status: BitcoinInstallResult["status"],
  appOpen: boolean,
  handoff: BitcoinInstallResult["handoff"],
): BitcoinInstallResult {
  return Object.freeze({ status, appOpen, handoff });
}

function safeError(
  code: BitcoinInstallerErrorCode,
  phase: BitcoinInstallerPhase,
  message = "RAW VENDOR USB SERIAL secret-device-id",
): unknown {
  return Object.freeze({
    name: "BitcoinInstallerError",
    code,
    phase,
    recoverable: true,
    message,
  });
}

function createFakeInstaller(
  overrides: Partial<BitcoinAppInstaller> = {},
): FakeInstaller {
  const listeners = new Set<(event: BitcoinInstallerEvent) => void>();
  const unsubscribe = vi.fn();
  const prepare = vi.fn(() => Promise.resolve(plan("installation-required")));
  const install = vi.fn(() =>
    Promise.resolve(result("installed", true, "ready")),
  );
  const recover = vi.fn(() => Promise.resolve(plan("already-installed")));
  const cancel = vi.fn();
  const dispose = vi.fn(() => Promise.resolve());

  const installer: FakeInstaller = {
    prepare,
    install,
    recover,
    cancel,
    dispose,
    unsubscribe,
    subscribe(listener) {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        unsubscribe();
      };
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };

  Object.assign(installer, overrides);
  return installer;
}

async function checkAndWaitForPlan(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Check Ledger" }));
  await waitFor(() => {
    expect(screen.getByText("Ready for confirmation")).toBeVisible();
  });
}

describe("BitcoinAppInstallerFlow", () => {
  it("starts preparation in the click task, coalesces duplicate clicks, and renders normalized events", async () => {
    const preparation = deferred<BitcoinInstallPlan>();
    let clickTaskActive = false;
    const installer = createFakeInstaller({
      prepare: vi.fn(() => {
        expect(clickTaskActive).toBe(true);
        return preparation.promise;
      }),
    });
    const factory = vi.fn(() => installer);

    render(<BitcoinAppInstallerFlow createInstaller={factory} />);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ready to check")).toBeVisible();
    const checkButton = screen.getByRole("button", { name: "Check Ledger" });

    act(() => {
      clickTaskActive = true;
      checkButton.click();
      checkButton.click();
      clickTaskActive = false;
    });

    expect(installer.prepare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();

    act(() => {
      installer.emit({
        phase: "installing",
        interaction: "confirm-install",
        progress: 42,
      });
    });
    expect(screen.getByText("Installing Bitcoin")).toBeVisible();
    expect(
      screen.getByText(/review the Bitcoin installation request/i),
    ).toBeVisible();
    expect(screen.getByTestId("ledger-installer-progress")).toHaveTextContent(
      "42%",
    );

    await act(async () => {
      preparation.resolve(plan("installation-required"));
      await preparation.promise;
    });

    expect(screen.getByTestId("installation-required")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Install Bitcoin app",
      }),
    ).toBeVisible();
  });

  it("uses the exact already-installed plan only after a separate click and never starts signing", async () => {
    const alreadyInstalled = plan("already-installed");
    const completion = deferred<BitcoinInstallResult>();
    const installer = createFakeInstaller({
      prepare: vi.fn(() => Promise.resolve(alreadyInstalled)),
      install: vi.fn(() => completion.promise),
    });

    render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
    await checkAndWaitForPlan();

    expect(installer.install).not.toHaveBeenCalled();
    expect(screen.getByTestId("already-installed")).toHaveTextContent(
      /will not install or update/i,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Bitcoin app" }));
    expect(installer.install).toHaveBeenCalledTimes(1);
    expect(installer.install).toHaveBeenCalledWith(alreadyInstalled);

    await act(async () => {
      completion.resolve(result("already-installed", true, "ready"));
      await completion.promise;
    });

    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /already installed; no install or update was attempted/i,
    );
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /Bitcoin opened successfully/i,
    );
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /separate user click outside this flow/i,
    );
    expect(
      screen.queryByRole("button", { name: /webusb|sign/i }),
    ).not.toBeInTheDocument();
  });

  it("renders simulated plans and results only as modeled evidence", async () => {
    const installer = createFakeInstaller();

    render(
      <BitcoinAppInstallerFlow
        createInstaller={() => installer}
        simulationOnly
      />,
    );
    expect(
      screen.getByTestId("ledger-installer-simulation-notice"),
    ).toHaveTextContent(/no device will be checked or changed/i);

    await checkAndWaitForPlan();
    expect(screen.getByTestId("installation-required")).toHaveTextContent(
      /scenario state/i,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Install Bitcoin app" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("ledger-installer-result")).toBeVisible();
    });
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /simulation complete.*modeled a verified Bitcoin app installation/i,
    );
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /modeled a released management connection/i,
    );
    expect(screen.getByTestId("ledger-installer-result")).not.toHaveTextContent(
      /was installed|was observed closed/i,
    );
  });

  it("shows app-open and reconnect guidance as independent terminal facts", async () => {
    const installer = createFakeInstaller({
      install: vi.fn(() =>
        Promise.resolve(result("installed", false, "reconnect-required")),
      ),
    });

    render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
    await checkAndWaitForPlan();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install Bitcoin app",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("ledger-installer-result")).toBeVisible();
    });
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /installed and independently verified/i,
    );
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /could not be opened automatically/i,
    );
    expect(screen.getByTestId("ledger-installer-result")).toHaveTextContent(
      /reconnect or reselect/i,
    );
    expect(
      screen.queryByRole("button", { name: /webusb|sign/i }),
    ).not.toBeInTheDocument();
  });

  it("requests cooperative cancellation without treating the click as completion", async () => {
    const preparation = deferred<BitcoinInstallPlan>();
    const installer = createFakeInstaller({
      prepare: vi.fn(() => preparation.promise),
    });

    render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Ledger" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(installer.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Check Ledger again" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      preparation.reject(safeError("cancelled", "selecting-device"));
      await preparation.promise.catch(() => undefined);
    });

    expect(screen.getByText("Check cancelled")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check Ledger again" }),
    ).toBeVisible();
  });

  it("can cancel an unconsumed confirmation plan without installing it", async () => {
    const installer = createFakeInstaller();
    installer.cancel.mockImplementation(() => {
      installer.emit({ phase: "cancelled" });
    });

    render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
    await checkAndWaitForPlan();

    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(installer.cancel).toHaveBeenCalledTimes(1);
    expect(installer.install).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Check Ledger again" }),
    ).toBeVisible();
  });

  it("withdraws a prepared plan when the installer reports terminal failure", async () => {
    const installer = createFakeInstaller();

    render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
    await checkAndWaitForPlan();

    act(() => installer.emit({ phase: "failed" }));

    expect(screen.getByText("Check failed")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Install Bitcoin app" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start a new Ledger check" }),
    ).toBeVisible();
  });

  it.each(["state-unknown", "insufficient-space"] as const)(
    "recovers %s only through recover() from a fresh click",
    async (code) => {
      const recoveredPlan = plan("already-installed");
      const recovery = deferred<BitcoinInstallPlan>();
      let clickTaskActive = false;
      const installer = createFakeInstaller({
        install: vi.fn(() => Promise.reject(safeError(code, "verifying"))),
        recover: vi.fn(() => {
          expect(clickTaskActive).toBe(true);
          return recovery.promise;
        }),
      });

      render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
      await checkAndWaitForPlan();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Install Bitcoin app",
        }),
      );

      await waitFor(() => {
        expect(screen.getByText("A fresh check is required")).toBeVisible();
      });
      expect(screen.getByTestId("ledger-error")).not.toHaveTextContent(
        "RAW VENDOR USB SERIAL",
      );
      expect(installer.recover).not.toHaveBeenCalled();

      const recoverButton = screen.getByRole("button", {
        name: "Recover with a fresh check",
      });
      act(() => {
        clickTaskActive = true;
        recoverButton.click();
        clickTaskActive = false;
      });
      expect(installer.recover).toHaveBeenCalledTimes(1);
      expect(installer.install).toHaveBeenCalledTimes(1);

      await act(async () => {
        recovery.resolve(recoveredPlan);
        await recovery.promise;
      });

      expect(screen.getByTestId("already-installed")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Open Bitcoin app" }),
      ).toBeVisible();
    },
  );

  it("recognizes a structural user-refused error but never renders its message or calls recover", async () => {
    const installer = createFakeInstaller({
      install: vi.fn(() =>
        Promise.reject(
          safeError(
            "user-refused",
            "installing",
            "Approve this raw vendor instruction and reveal device-id-123",
          ),
        ),
      ),
    });

    render(<BitcoinAppInstallerFlow createInstaller={() => installer} />);
    await checkAndWaitForPlan();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install Bitcoin app",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Check failed")).toBeVisible();
    });
    expect(screen.getByTestId("ledger-error")).toHaveTextContent(
      /action was refused on the Ledger/i,
    );
    expect(screen.getByTestId("ledger-error")).not.toHaveTextContent(
      /raw vendor instruction|device-id-123/i,
    );
    expect(
      screen.queryByRole("button", { name: /recover/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start a new Ledger check" }),
    ).toBeVisible();
    expect(installer.recover).not.toHaveBeenCalled();
  });

  it("disposes the failed instance before a reset creates a fresh workflow", async () => {
    const disposal = deferred<void>();
    const order: string[] = [];
    const first = createFakeInstaller({
      prepare: vi.fn(() =>
        Promise.reject({
          get code() {
            throw new Error("hostile getter");
          },
          message: "private raw failure",
        }),
      ),
      dispose: vi.fn(() => {
        order.push("dispose-first");
        return disposal.promise;
      }),
    });
    const second = createFakeInstaller();
    const factory = vi
      .fn<() => BitcoinAppInstaller>()
      .mockImplementationOnce(() => {
        order.push("create-first");
        return first;
      })
      .mockImplementationOnce(() => {
        order.push("create-second");
        return second;
      });

    render(<BitcoinAppInstallerFlow createInstaller={factory} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Ledger" }));
    await waitFor(() => {
      expect(screen.getByText("Check failed")).toBeVisible();
    });
    expect(screen.getByTestId("ledger-error")).toHaveTextContent(
      /could not be completed safely/i,
    );
    expect(screen.getByTestId("ledger-error")).not.toHaveTextContent(
      /private raw failure|hostile getter/i,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Start a new Ledger check" }),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();

    await act(async () => {
      disposal.resolve();
      await disposal.promise;
    });
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));

    expect(order).toEqual(["create-first", "dispose-first", "create-second"]);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ready to check")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Check Ledger" }));
    expect(second.prepare).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes and disposes once when the component unmounts", async () => {
    const installer = createFakeInstaller();
    const { unmount } = render(
      <BitcoinAppInstallerFlow createInstaller={() => installer} />,
    );

    unmount();

    expect(installer.unsubscribe).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(installer.dispose).toHaveBeenCalledTimes(1));
  });
});
