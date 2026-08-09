import React from "react";

import {
  createBitcoinAppInstaller,
  getBitcoinInstallerSupport,
  type BitcoinAppInstaller,
  type BitcoinInstallerSupport,
} from "@caravan/ledger";
import { Alert, AlertTitle, Box, Typography } from "@mui/material";

import { LEDGER_BITCOIN_BACKEND_AUTHORIZED } from "../../config/ledgerBitcoinPoc";
import { BitcoinAppInstallerFlow } from "./BitcoinAppInstallerFlow";

interface LedgerBitcoinInstallerLivePageProps {
  /** Test seam; production is controlled only by the compile-time gate. */
  readonly authorizationConfirmed?: boolean;
  readonly createInstaller?: () => BitcoinAppInstaller;
  readonly readSupport?: () => BitcoinInstallerSupport;
}

const SUPPORT_COPY: Readonly<
  Record<NonNullable<BitcoinInstallerSupport["reason"]>, string>
> = {
  "not-browser": "Open this page in a supported desktop browser.",
  "insecure-context": "Serve Caravan over HTTPS or an approved localhost URL.",
  "webhid-unavailable":
    "Use a desktop Chromium browser with WebHID enabled, such as Chrome or Edge.",
};

/**
 * Authorized-hardware composition for the real `@caravan/ledger` adapter.
 * Importing and rendering this page does not prompt for a device or contact a
 * service. The first WebHID chooser remains synchronous in the flow's button
 * click, and this page withholds that flow until the external legal gate is
 * explicitly confirmed by the build operator.
 */
export function LedgerBitcoinInstallerLivePage({
  authorizationConfirmed = LEDGER_BITCOIN_BACKEND_AUTHORIZED,
  createInstaller = createBitcoinAppInstaller,
  readSupport = getBitcoinInstallerSupport,
}: LedgerBitcoinInstallerLivePageProps) {
  const support = readSupport();

  return (
    <Box
      component="section"
      aria-labelledby="ledger-installer-live-title"
      sx={{
        margin: "0 auto",
        maxWidth: 840,
        pt: { xs: 7, md: 0 },
        width: "100%",
      }}
    >
      <Typography id="ledger-installer-live-title" component="h1" variant="h4">
        Install the Bitcoin app on a Ledger
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3, mt: 1 }}>
        This path uses Ledger&apos;s official TypeScript Device Management Kit,
        WebHID, and the real Bitcoin application install action.
      </Typography>

      {!authorizationConfirmed ? (
        <Alert
          severity="error"
          variant="filled"
          sx={{ mb: 3 }}
          data-testid="ledger-installer-authorization-gate"
        >
          <AlertTitle>REAL LEDGER PLUMBING — LIVE SERVICES LOCKED</AlertTitle>
          Ledger&apos;s open-source SDK may be integrated and tested offline,
          but its Manager and ScriptRunner backend services require Ledger
          SAS&apos;s written authorization. This build will not show the device
          action controls until an operator explicitly confirms that
          authorization.
        </Alert>
      ) : (
        <Alert
          severity="warning"
          variant="filled"
          sx={{ mb: 3 }}
          data-testid="ledger-installer-authorized-mode"
        >
          <AlertTitle>AUTHORIZED HARDWARE TEST MODE</AlertTitle>
          Continuing can contact Ledger&apos;s approved HTTPS and WebSocket
          services and can request installation on the connected device. Use
          only a dedicated lab Ledger. The physical device screen is
          authoritative.
        </Alert>
      )}

      {!support.supported ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          <AlertTitle>This browser cannot start the Ledger flow</AlertTitle>
          {support.reason
            ? SUPPORT_COPY[support.reason]
            : "The required browser capabilities are unavailable."}
        </Alert>
      ) : null}

      {!authorizationConfirmed ? (
        <Box sx={{ mb: 3 }}>
          <Typography component="h2" variant="h6">
            What is already wired
          </Typography>
          <Box component="ul" sx={{ mt: 1, pl: 3 }}>
            <li>Ledger-only WebHID discovery and connection</li>
            <li>Genuine-device and supported-model gates</li>
            <li>Installed-app inspection reduced to Bitcoin presence</li>
            <li>Fixed Bitcoin install, independent verification, and open</li>
            <li>Cancellation, recovery, cleanup, and WebHID release checks</li>
          </Box>
          <Typography color="text.secondary">
            The package&apos;s compiled device-model allowlist is also empty and
            remains an independent fail-closed gate. Authorization and a
            physically validated model must be enabled together.
          </Typography>
        </Box>
      ) : null}

      {authorizationConfirmed && support.supported ? (
        <BitcoinAppInstallerFlow createInstaller={createInstaller} />
      ) : null}
    </Box>
  );
}

export default LedgerBitcoinInstallerLivePage;
