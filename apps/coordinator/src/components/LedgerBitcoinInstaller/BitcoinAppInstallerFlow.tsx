import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  LinearProgress,
  Typography,
} from "@mui/material";
import type {
  BitcoinAppInstaller,
  BitcoinInstallerErrorCode,
  BitcoinInstallerEvent,
  BitcoinInstallerInteraction,
  BitcoinInstallerPhase,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "@caravan/ledger";

export interface BitcoinAppInstallerFlowProps {
  /**
   * The host owns the choice between a live and simulated implementation.
   * This component never constructs a transport or accesses browser APIs.
   */
  createInstaller: () => BitcoinAppInstaller;
  /** Render every device-state claim as simulated acceptance evidence. */
  simulationOnly?: boolean;
}

interface NormalizedFailure {
  readonly code: BitcoinInstallerErrorCode;
  readonly phase?: BitcoinInstallerPhase;
}

interface FlowView {
  readonly phase: BitcoinInstallerPhase;
  readonly interaction?: BitcoinInstallerInteraction;
  readonly progress?: number;
  readonly plan?: BitcoinInstallPlan;
  readonly result?: BitcoinInstallResult;
  readonly failure?: NormalizedFailure;
  readonly busy: boolean;
  readonly cancelRequested: boolean;
  readonly resetting: boolean;
}

interface Workflow {
  readonly id: number;
  readonly installer: BitcoinAppInstaller;
}

const INITIAL_VIEW: FlowView = Object.freeze({
  phase: "idle",
  busy: false,
  cancelRequested: false,
  resetting: false,
});

const PHASE_COPY: Readonly<Record<BitcoinInstallerPhase, string>> = {
  idle: "Ready to check",
  "selecting-device": "Select a Ledger",
  connecting: "Connecting",
  "checking-genuine": "Checking device authenticity",
  "checking-bitcoin-app": "Checking the Bitcoin app",
  "ready-to-install": "Ready for confirmation",
  installing: "Installing Bitcoin",
  verifying: "Verifying Bitcoin",
  "opening-bitcoin": "Opening Bitcoin",
  "releasing-device": "Releasing the management connection",
  "ready-for-webusb": "Bitcoin app ready",
  "needs-recovery": "A fresh check is required",
  cancelled: "Check cancelled",
  failed: "Check failed",
  disposed: "Workflow closed",
};

const INTERACTION_COPY: Readonly<Record<BitcoinInstallerInteraction, string>> =
  {
    "select-device": "Choose the Ledger in your browser's device picker.",
    "unlock-device": "Unlock the Ledger. Never enter its PIN in Caravan.",
    "allow-secure-connection":
      "Review the secure-connection request on the Ledger itself.",
    "confirm-install":
      "Review the Bitcoin installation request on the Ledger itself.",
    "confirm-open-bitcoin":
      "Review the request to open Bitcoin on the Ledger itself.",
  };

const FAILURE_COPY: Readonly<Record<BitcoinInstallerErrorCode, string>> = {
  "unsupported-environment":
    "This browser environment cannot run the Ledger preparation flow.",
  "permission-denied": "Ledger device permission was denied.",
  "no-device-selected": "No Ledger was selected.",
  "device-busy": "The Ledger is currently in use by another connection.",
  "device-disconnected": "The Ledger was disconnected.",
  "device-locked": "Unlock the Ledger before trying again.",
  "device-not-onboarded": "The Ledger has not completed device setup.",
  "device-not-genuine":
    "The Ledger did not pass the authenticity check. Do not continue.",
  "unsupported-device": "This Ledger model is not approved for this flow.",
  "unsupported-firmware": "This Ledger firmware is not approved for this flow.",
  "user-refused":
    "The action was refused on the Ledger. No success is assumed.",
  "bitcoin-app-unsupported":
    "The available Bitcoin app is not supported by this flow.",
  "insufficient-space":
    "The Ledger reported insufficient space. Run a fresh check before deciding what to do next.",
  "network-unavailable":
    "The approved network connection is currently unavailable.",
  "ledger-service-unavailable":
    "The approved Ledger service is currently unavailable.",
  "secure-channel-failed":
    "The secure management connection could not be completed.",
  "operation-timeout": "The Ledger operation timed out.",
  cancelled: "The Ledger check was cancelled.",
  "state-unknown":
    "Caravan could not verify the Bitcoin app state. Run a fresh recovery check; do not retry installation.",
  internal: "The Ledger preparation flow could not be completed safely.",
};

const ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(FAILURE_COPY));
const PHASES: ReadonlySet<string> = new Set(Object.keys(PHASE_COPY));
const RECOVERY_CODES: ReadonlySet<BitcoinInstallerErrorCode> = new Set([
  "insufficient-space",
  "state-unknown",
]);

function safeRead(target: unknown, property: PropertyKey): unknown {
  if (
    (typeof target !== "object" || target === null) &&
    typeof target !== "function"
  ) {
    return undefined;
  }
  try {
    return Reflect.get(target, property);
  } catch {
    return undefined;
  }
}

function normalizeFailure(error: unknown): NormalizedFailure {
  const code = safeRead(error, "code");
  const phase = safeRead(error, "phase");
  return {
    code:
      typeof code === "string" && ERROR_CODES.has(code)
        ? (code as BitcoinInstallerErrorCode)
        : "internal",
    phase:
      typeof phase === "string" && PHASES.has(phase)
        ? (phase as BitcoinInstallerPhase)
        : undefined,
  };
}

function normalizeProgress(progress: number | undefined): number | undefined {
  if (!Number.isFinite(progress)) return undefined;
  return Math.max(0, Math.min(100, Math.round(progress as number)));
}

function phaseAfterFailure(failure: NormalizedFailure): BitcoinInstallerPhase {
  if (RECOVERY_CODES.has(failure.code)) return "needs-recovery";
  if (failure.code === "cancelled") return "cancelled";
  return "failed";
}

function resultSummary(
  result: BitcoinInstallResult,
  simulationOnly: boolean,
): string {
  if (simulationOnly) {
    return result.status === "installed"
      ? "Simulation complete: the scenario modeled a verified Bitcoin app installation."
      : "Simulation complete: the scenario modeled Bitcoin as already installed; no install or update was attempted.";
  }
  return result.status === "installed"
    ? "The official Bitcoin app was installed and independently verified."
    : "The official Bitcoin app was already installed; no install or update was attempted.";
}

/**
 * Coordinator-owned presentation and orchestration for one installer workflow.
 * It intentionally exposes no WebUSB or signing continuation.
 */
export function BitcoinAppInstallerFlow({
  createInstaller,
  simulationOnly = false,
}: BitcoinAppInstallerFlowProps) {
  const nextWorkflowId = useRef(1);
  const [workflow, setWorkflow] = useState<Workflow>(() => ({
    id: nextWorkflowId.current,
    installer: createInstaller(),
  }));
  const [view, setView] = useState<FlowView>(INITIAL_VIEW);
  const mounted = useRef(true);
  const workflowRef = useRef(workflow);
  const factoryRef = useRef(createInstaller);
  const operationId = useRef(0);
  const busyRef = useRef(false);
  const disposals = useRef(new WeakMap<BitcoinAppInstaller, Promise<void>>());

  workflowRef.current = workflow;
  factoryRef.current = createInstaller;

  const disposeOnce = useCallback(
    (installer: BitcoinAppInstaller): Promise<void> => {
      const existing = disposals.current.get(installer);
      if (existing) return existing;

      let disposal: Promise<void>;
      try {
        disposal = Promise.resolve(installer.dispose());
      } catch (error) {
        disposal = Promise.reject(error);
      }
      disposals.current.set(installer, disposal);
      return disposal;
    },
    [],
  );

  useEffect(() => {
    return () => {
      mounted.current = false;
      operationId.current += 1;
      busyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const activeWorkflow = workflow;
    const unsubscribe = activeWorkflow.installer.subscribe(
      (event: BitcoinInstallerEvent) => {
        if (!mounted.current || workflowRef.current.id !== activeWorkflow.id) {
          return;
        }
        const cancelled = event.phase === "cancelled";
        const planInvalidated =
          event.phase === "cancelled" ||
          event.phase === "failed" ||
          event.phase === "needs-recovery" ||
          event.phase === "disposed";
        if (cancelled) busyRef.current = false;
        setView((current) => ({
          ...current,
          phase: event.phase,
          interaction: event.interaction,
          progress: normalizeProgress(event.progress),
          plan: planInvalidated ? undefined : current.plan,
          busy: cancelled ? false : current.busy,
          cancelRequested: cancelled ? false : current.cancelRequested,
        }));
      },
    );

    return () => {
      unsubscribe();
      void disposeOnce(activeWorkflow.installer).catch(() => undefined);
    };
  }, [disposeOnce, workflow]);

  const operationIsCurrent = useCallback(
    (workflowId: number, id: number): boolean =>
      mounted.current &&
      workflowRef.current.id === workflowId &&
      operationId.current === id,
    [],
  );

  const settleFailure = useCallback(
    (error: unknown, workflowId: number, id: number) => {
      if (!operationIsCurrent(workflowId, id)) return;
      const failure = normalizeFailure(error);
      busyRef.current = false;
      setView((current) => ({
        ...current,
        phase: phaseAfterFailure(failure),
        interaction: undefined,
        progress: undefined,
        plan: undefined,
        result: undefined,
        failure,
        busy: false,
        cancelRequested: false,
      }));
    },
    [operationIsCurrent],
  );

  const checkFromClick = () => {
    if (busyRef.current || view.resetting) return;
    busyRef.current = true;
    const activeWorkflow = workflowRef.current;
    const id = operationId.current + 1;
    operationId.current = id;
    setView((current) => ({
      ...current,
      phase: "selecting-device",
      interaction: "select-device",
      progress: undefined,
      plan: undefined,
      result: undefined,
      failure: undefined,
      busy: true,
      cancelRequested: false,
    }));

    let preparation: Promise<BitcoinInstallPlan>;
    try {
      // Deliberately no await, dynamic import, timer, or microtask before this.
      preparation = activeWorkflow.installer.prepare();
    } catch (error) {
      settleFailure(error, activeWorkflow.id, id);
      return;
    }

    void preparation.then(
      (plan) => {
        if (!operationIsCurrent(activeWorkflow.id, id)) return;
        busyRef.current = false;
        setView((current) => ({
          ...current,
          phase: "ready-to-install",
          interaction: undefined,
          progress: undefined,
          plan,
          failure: undefined,
          busy: false,
          cancelRequested: false,
        }));
      },
      (error: unknown) => settleFailure(error, activeWorkflow.id, id),
    );
  };

  const installFromClick = () => {
    if (busyRef.current || view.resetting || !view.plan) return;
    busyRef.current = true;
    const activeWorkflow = workflowRef.current;
    const plan = view.plan;
    const id = operationId.current + 1;
    operationId.current = id;
    setView((current) => ({
      ...current,
      phase: "installing",
      interaction: undefined,
      progress: undefined,
      plan: undefined,
      failure: undefined,
      busy: true,
      cancelRequested: false,
    }));

    let installation: Promise<BitcoinInstallResult>;
    try {
      installation = activeWorkflow.installer.install(plan);
    } catch (error) {
      settleFailure(error, activeWorkflow.id, id);
      return;
    }

    void installation.then(
      (result) => {
        if (!operationIsCurrent(activeWorkflow.id, id)) return;
        busyRef.current = false;
        setView((current) => ({
          ...current,
          phase: "ready-for-webusb",
          interaction: undefined,
          progress: undefined,
          result,
          failure: undefined,
          busy: false,
          cancelRequested: false,
        }));
      },
      (error: unknown) => settleFailure(error, activeWorkflow.id, id),
    );
  };

  const recoverFromClick = () => {
    if (busyRef.current || view.resetting || view.phase !== "needs-recovery") {
      return;
    }
    busyRef.current = true;
    const activeWorkflow = workflowRef.current;
    const id = operationId.current + 1;
    operationId.current = id;
    setView((current) => ({
      ...current,
      phase: "selecting-device",
      interaction: "select-device",
      progress: undefined,
      plan: undefined,
      result: undefined,
      failure: undefined,
      busy: true,
      cancelRequested: false,
    }));

    let recovery: Promise<BitcoinInstallPlan>;
    try {
      // Recovery also owns a new chooser and must start in this click task.
      recovery = activeWorkflow.installer.recover();
    } catch (error) {
      settleFailure(error, activeWorkflow.id, id);
      return;
    }

    void recovery.then(
      (plan) => {
        if (!operationIsCurrent(activeWorkflow.id, id)) return;
        busyRef.current = false;
        setView((current) => ({
          ...current,
          phase: "ready-to-install",
          interaction: undefined,
          progress: undefined,
          plan,
          failure: undefined,
          busy: false,
          cancelRequested: false,
        }));
      },
      (error: unknown) => settleFailure(error, activeWorkflow.id, id),
    );
  };

  const cancelFromClick = () => {
    const cancellingPreparedPlan = !busyRef.current && view.plan !== undefined;
    if ((!busyRef.current && !cancellingPreparedPlan) || view.cancelRequested) {
      return;
    }
    if (cancellingPreparedPlan) busyRef.current = true;
    setView((current) => ({
      ...current,
      plan: undefined,
      busy: true,
      cancelRequested: true,
    }));
    workflowRef.current.installer.cancel();
  };

  const resetFromClick = () => {
    if (busyRef.current || view.resetting) return;
    busyRef.current = true;
    operationId.current += 1;
    const staleWorkflow = workflowRef.current;
    setView((current) => ({
      ...current,
      plan: undefined,
      result: undefined,
      failure: undefined,
      busy: true,
      cancelRequested: false,
      resetting: true,
    }));

    void disposeOnce(staleWorkflow.installer).then(
      () => {
        if (!mounted.current || workflowRef.current.id !== staleWorkflow.id) {
          return;
        }

        let freshInstaller: BitcoinAppInstaller;
        try {
          freshInstaller = factoryRef.current();
        } catch {
          busyRef.current = false;
          setView({
            ...INITIAL_VIEW,
            phase: "failed",
            failure: { code: "internal" },
          });
          return;
        }

        const freshWorkflow = {
          id: nextWorkflowId.current + 1,
          installer: freshInstaller,
        };
        nextWorkflowId.current = freshWorkflow.id;
        workflowRef.current = freshWorkflow;
        busyRef.current = false;
        setWorkflow(freshWorkflow);
        setView(INITIAL_VIEW);
      },
      () => {
        if (!mounted.current || workflowRef.current.id !== staleWorkflow.id) {
          return;
        }
        busyRef.current = false;
        setView({
          ...INITIAL_VIEW,
          phase: "failed",
          failure: { code: "internal" },
        });
      },
    );
  };

  const canCancel =
    (view.busy || view.plan !== undefined) &&
    !view.cancelRequested &&
    !view.resetting &&
    view.phase !== "releasing-device";
  const canCheck =
    !view.busy && (view.phase === "idle" || view.phase === "cancelled");
  const canRecover = !view.busy && view.phase === "needs-recovery";
  const canReset =
    !view.busy &&
    (view.phase === "failed" || view.phase === "ready-for-webusb");

  return (
    <Card data-testid="ledger-bitcoin-installer-flow">
      <CardHeader
        title="Install the Bitcoin app on Ledger"
        titleTypographyProps={{ component: "h2", variant: "h5" }}
      />
      <CardContent>
        {simulationOnly && (
          <Alert
            severity="warning"
            variant="outlined"
            sx={{ mb: 2 }}
            data-testid="ledger-installer-simulation-notice"
          >
            Simulation preview: no device will be checked or changed.
          </Alert>
        )}
        <Typography component="p" color="text.secondary">
          {simulationOnly ? "In a live flow, Caravan checks" : "Caravan checks"}
          {
            " only for Ledger's official Bitcoin app. Trust the physical Ledger "
          }
          screen, and never enter a PIN or recovery phrase here.
        </Typography>

        <Box component="dl" mt={2} mb={2}>
          <Typography component="dt" fontWeight="bold">
            Phase
          </Typography>
          <Typography
            component="dd"
            data-testid="ledger-installer-phase"
            ml={0}
            aria-live="polite"
            aria-atomic="true"
          >
            {PHASE_COPY[view.phase]}
          </Typography>
        </Box>

        {view.interaction && (
          <Alert severity="info" data-testid="ledger-installer-interaction">
            {simulationOnly ? "Simulated prompt: " : ""}
            {INTERACTION_COPY[view.interaction]}
          </Alert>
        )}

        {view.progress !== undefined && (
          <Box mt={2}>
            <LinearProgress
              aria-label="Ledger preparation progress"
              variant="determinate"
              value={view.progress}
            />
            <Typography component="p" data-testid="ledger-installer-progress">
              {view.progress}%
            </Typography>
          </Box>
        )}

        {view.plan?.status === "installation-required" && (
          <Alert severity="warning" data-testid="installation-required">
            {simulationOnly
              ? "Scenario state: Bitcoin is not installed. Continuing simulates the official Bitcoin app installation request."
              : "Bitcoin is not installed. Continuing may ask you to approve the official Bitcoin app installation on the Ledger."}
          </Alert>
        )}

        {view.plan?.status === "already-installed" && (
          <Alert severity="info" data-testid="already-installed">
            {simulationOnly
              ? "Scenario state: Bitcoin is already installed. Continuing simulates one open attempt and management-connection release; no install or update is modeled."
              : "Bitcoin is already installed. Caravan will not install or update it; continuing makes one attempt to open Bitcoin and then releases the management connection."}
          </Alert>
        )}

        {view.failure && (
          <Alert severity="error" role="alert" data-testid="ledger-error">
            {FAILURE_COPY[view.failure.code]}
            {view.failure.phase && (
              <Typography component="span" display="block">
                Stopped during: {PHASE_COPY[view.failure.phase]}.
              </Typography>
            )}
          </Alert>
        )}

        {view.result && (
          <Box data-testid="ledger-installer-result">
            <Alert severity="success">
              {resultSummary(view.result, simulationOnly)}
            </Alert>
            <Typography component="p" mt={1}>
              {simulationOnly
                ? view.result.appOpen
                  ? "The scenario modeled Bitcoin opening successfully."
                  : "The scenario modeled an unsuccessful Bitcoin open attempt."
                : view.result.appOpen
                  ? "Bitcoin opened successfully."
                  : "Bitcoin could not be opened automatically. Open it on the Ledger before a later signing action."}
            </Typography>
            <Typography component="p" mt={1}>
              {simulationOnly
                ? view.result.handoff === "ready"
                  ? "The scenario modeled a released management connection. No WebUSB or signing action is available in this preview."
                  : "The scenario modeled a required reconnect. No WebUSB or signing action is available in this preview."
                : view.result.handoff === "ready"
                  ? "The management connection was observed closed. Any WebUSB or signing action must still start from a separate user click outside this flow."
                  : "Reconnect or reselect the Ledger before any later WebUSB or signing action. This flow will not start one automatically."}
            </Typography>
          </Box>
        )}

        <Box display="flex" flexWrap="wrap" gap={1} mt={2}>
          {canCheck && (
            <Button variant="contained" onClick={checkFromClick}>
              {view.phase === "cancelled"
                ? "Check Ledger again"
                : "Check Ledger"}
            </Button>
          )}

          {view.plan && !view.busy && (
            <Button variant="contained" onClick={installFromClick}>
              {view.plan.status === "installation-required"
                ? "Install Bitcoin app"
                : "Open Bitcoin app"}
            </Button>
          )}

          {canCancel && (
            <Button variant="outlined" onClick={cancelFromClick}>
              Cancel
            </Button>
          )}

          {view.cancelRequested && (
            <Button variant="outlined" disabled>
              Cancelling…
            </Button>
          )}

          {canRecover && (
            <Button variant="contained" onClick={recoverFromClick}>
              Recover with a fresh check
            </Button>
          )}

          {canReset && (
            <Button variant="outlined" onClick={resetFromClick}>
              Start a new Ledger check
            </Button>
          )}

          {view.resetting && (
            <Button variant="outlined" disabled>
              Resetting…
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
