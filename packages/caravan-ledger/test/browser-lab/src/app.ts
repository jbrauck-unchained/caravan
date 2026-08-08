import type {
  BitcoinAppInstaller,
  BitcoinInstallerEvent,
  BitcoinInstallerSupport,
  BitcoinInstallResult,
} from "@caravan/ledger";

import {
  BrowserLabController,
  type BrowserLabPhase,
  type BrowserLabSnapshot,
  intentionallyLateDynamicImport,
} from "./controller";

interface BrowserLabPublicState {
  support: BitcoinInstallerSupport | undefined;
  snapshot: BrowserLabSnapshot | undefined;
  readonly events: BitcoinInstallerEvent[];
  readonly phases: BrowserLabPhase[];
  workflowCount: number;
  disposedWorkflowCount: number;
  webUsbCalls: number;
  readonly webUsbActivation: boolean[];
  lateImportActivation: boolean | undefined;
  lateImportInvokedPrepare: boolean | undefined;
}

declare global {
  interface Window {
    __CARAVAN_LEDGER_BROWSER_LAB__: BrowserLabPublicState;
  }
}

function requireElement<T extends HTMLElement>(testId: string): T {
  const element = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element)
    throw new Error(`Missing private browser-lab element: ${testId}`);
  return element;
}

const prepareButton = requireElement<HTMLButtonElement>("prepare");
const cancelButton = requireElement<HTMLButtonElement>("cancel");
const installButton = requireElement<HTMLButtonElement>("install");
const continuationButton = requireElement<HTMLButtonElement>("continue-webusb");
const lateImportButton = requireElement<HTMLButtonElement>("late-import");
const readyButton = requireElement<HTMLButtonElement>("inject-ready");
const reconnectButton = requireElement<HTMLButtonElement>("inject-reconnect");
const supportOutput = requireElement<HTMLOutputElement>("support");
const phaseOutput = requireElement<HTMLOutputElement>("phase");
const eventOutput = requireElement<HTMLOutputElement>("events");
const lateOutput = requireElement<HTMLOutputElement>("late-result");

const publicState: BrowserLabPublicState = {
  support: undefined,
  snapshot: undefined,
  events: [],
  phases: [],
  workflowCount: 0,
  disposedWorkflowCount: 0,
  webUsbCalls: 0,
  webUsbActivation: [],
  lateImportActivation: undefined,
  lateImportInvokedPrepare: undefined,
};
window.__CARAVAN_LEDGER_BROWSER_LAB__ = publicState;

const ledger = await import("@caravan/ledger");
const support = ledger.getBitcoinInstallerSupport();
publicState.support = support;
supportOutput.value = JSON.stringify(support);

if (support.supported) {
  let installer: BitcoinAppInstaller;
  let controller: BrowserLabController;
  let pageIsHiding = false;
  let replacement: Promise<void> | undefined;

  const view = {
    render(snapshot: BrowserLabSnapshot) {
      publicState.snapshot = snapshot;
      publicState.phases.push(snapshot.phase);
      phaseOutput.value = snapshot.phase;
      document.body.dataset.phase = snapshot.phase;
      prepareButton.disabled = !snapshot.prepareEnabled;
      cancelButton.disabled = !snapshot.cancelEnabled;
      installButton.disabled = !snapshot.installEnabled;
      continuationButton.disabled = !snapshot.continuationEnabled;
    },
    renderEvent(event: BitcoinInstallerEvent) {
      publicState.events.push(event);
      eventOutput.value = publicState.events
        .map(({ phase }) => phase)
        .join(",");
    },
  };

  const createWorkflow = (): void => {
    installer = ledger.createBitcoinAppInstaller();
    controller = new BrowserLabController(
      installer,
      () => {
        publicState.webUsbCalls += 1;
        publicState.webUsbActivation.push(
          navigator.userActivation?.isActive === true,
        );
        document.body.dataset.webUsbCalls = String(publicState.webUsbCalls);
      },
      view,
    );
    publicState.workflowCount += 1;
    controller.start();
  };

  const replaceFailedWorkflow = (
    failedController: BrowserLabController,
  ): Promise<void> => {
    if (
      replacement ||
      pageIsHiding ||
      controller !== failedController ||
      failedController.snapshot.phase !== "failed"
    ) {
      return replacement ?? Promise.resolve();
    }

    const task = (async (): Promise<void> => {
      try {
        await failedController.dispose();
        publicState.disposedWorkflowCount += 1;
        if (!pageIsHiding && controller === failedController) createWorkflow();
      } catch {
        // A failed disposal must not create an overlapping replacement.
      } finally {
        replacement = undefined;
      }
    })();
    replacement = task;
    return task;
  };

  createWorkflow();

  prepareButton.addEventListener("click", () => {
    const activeController = controller;
    void activeController
      .prepareFromClick()
      .then(() => replaceFailedWorkflow(activeController));
  });
  cancelButton.addEventListener("click", () => controller.cancelFromClick());
  installButton.addEventListener("click", () => {
    void controller.installFromClick();
  });
  continuationButton.addEventListener("click", () => {
    void controller.continueFromClick();
  });

  lateImportButton.disabled = false;
  lateImportButton.addEventListener("click", () => {
    let synchronousClickTaskActive = true;
    void intentionallyLateDynamicImport(
      () => import("./late-prepare"),
      ({ observeLatePrepare }) => {
        const observation = observeLatePrepare(
          installer,
          synchronousClickTaskActive,
        );
        publicState.lateImportActivation = observation.active;
        publicState.lateImportInvokedPrepare = observation.invokedPrepare;
        lateOutput.value = observation.active
          ? "unexpectedly-active"
          : "blocked-after-dynamic-import";
      },
    );
    synchronousClickTaskActive = false;
  });

  const readyResult: BitcoinInstallResult = Object.freeze({
    status: "already-installed",
    appOpen: true,
    handoff: "ready",
  });
  const reconnectResult: BitcoinInstallResult = Object.freeze({
    status: "installed",
    appOpen: true,
    handoff: "reconnect-required",
  });
  readyButton.addEventListener("click", () =>
    controller.acceptResult(readyResult),
  );
  reconnectButton.addEventListener("click", () =>
    controller.acceptResult(reconnectResult),
  );

  window.addEventListener("pagehide", () => {
    if (pageIsHiding) return;
    pageIsHiding = true;
    const cleanup = replacement ?? controller.dispose();
    void cleanup.catch(() => undefined);
  });
}

document.body.dataset.labReady = "true";
