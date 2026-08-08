/** @vitest-environment jsdom */

import type {
  BitcoinAppInstaller,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "@caravan/ledger";

const ledgerMocks = vi.hoisted(() => ({
  createBitcoinAppInstaller: vi.fn(),
  getBitcoinInstallerSupport: vi.fn(),
}));

vi.mock("@caravan/ledger", () => ledgerMocks);

const plan = Object.freeze({
  status: "already-installed",
}) as BitcoinInstallPlan;

const result: BitcoinInstallResult = Object.freeze({
  status: "already-installed",
  appOpen: true,
  handoff: "ready",
});

function createInstaller(
  prepare: () => Promise<BitcoinInstallPlan>,
  dispose: () => Promise<void>,
): BitcoinAppInstaller {
  return {
    subscribe: () => () => undefined,
    prepare,
    install: () => Promise.resolve(result),
    recover: () => Promise.resolve(plan),
    cancel: () => undefined,
    dispose,
  };
}

function installDom(): void {
  document.body.innerHTML = `
    <output data-testid="support"></output>
    <output data-testid="phase"></output>
    <output data-testid="events"></output>
    <output data-testid="late-result"></output>
    <button data-testid="prepare" disabled></button>
    <button data-testid="cancel" disabled></button>
    <button data-testid="install" disabled></button>
    <button data-testid="continue-webusb" disabled></button>
    <button data-testid="late-import" disabled></button>
    <button data-testid="inject-ready"></button>
    <button data-testid="inject-reconnect"></button>
  `;
}

describe("private browser-lab application wiring", () => {
  it("disposes a chooser-dismissed workflow before enabling a fresh-click retry", async () => {
    vi.resetModules();
    ledgerMocks.createBitcoinAppInstaller.mockReset();
    ledgerMocks.getBitcoinInstallerSupport.mockReset();
    ledgerMocks.getBitcoinInstallerSupport.mockReturnValue({ supported: true });
    installDom();

    const firstPrepare = vi.fn(() =>
      Promise.reject({ code: "no-device-selected" }),
    );
    const firstDispose = vi.fn(() => Promise.resolve());
    const secondPrepare = vi.fn(
      () => new Promise<BitcoinInstallPlan>(() => undefined),
    );
    const secondDispose = vi.fn(() => Promise.resolve());
    ledgerMocks.createBitcoinAppInstaller
      .mockReturnValueOnce(createInstaller(firstPrepare, firstDispose))
      .mockReturnValueOnce(createInstaller(secondPrepare, secondDispose));

    await import("./src/app");
    const prepare = document.querySelector<HTMLButtonElement>(
      '[data-testid="prepare"]',
    );
    expect(prepare).not.toBeNull();
    expect(prepare?.disabled).toBe(false);

    prepare?.click();
    await vi.waitFor(() => {
      expect(firstDispose).toHaveBeenCalledTimes(1);
      expect(ledgerMocks.createBitcoinAppInstaller).toHaveBeenCalledTimes(2);
    });

    expect(window.__CARAVAN_LEDGER_BROWSER_LAB__).toMatchObject({
      workflowCount: 2,
      disposedWorkflowCount: 1,
    });
    expect(window.__CARAVAN_LEDGER_BROWSER_LAB__.phases.slice(-3)).toEqual([
      "failed",
      "disposed",
      "idle",
    ]);
    expect(prepare?.disabled).toBe(false);

    prepare?.click();
    expect(secondPrepare).toHaveBeenCalledTimes(1);
    expect(firstPrepare).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(secondDispose).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("pagehide"));
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });
});
