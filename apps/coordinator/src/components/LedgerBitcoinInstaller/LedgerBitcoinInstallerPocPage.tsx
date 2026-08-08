import React, { useCallback, useState } from "react";

import {
  Alert,
  AlertTitle,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";

import { BitcoinAppInstallerFlow } from "./BitcoinAppInstallerFlow";
import {
  createSimulatedBitcoinInstaller,
  SIMULATED_BITCOIN_INSTALLER_SCENARIOS,
  SIMULATED_BITCOIN_INSTALLER_SCENARIO_LABELS,
  type SimulatedBitcoinInstallerScenario,
} from "./simulatedBitcoinInstaller";

/**
 * Coordinator acceptance page for product and UX review. This page composes the
 * same flow used by a future authorized adapter, but supplies only an inert,
 * deterministic in-memory installer.
 */
export function LedgerBitcoinInstallerPocPage() {
  const [scenario, setScenario] =
    useState<SimulatedBitcoinInstallerScenario>("install-success");

  const createInstaller = useCallback(
    () => createSimulatedBitcoinInstaller({ scenario }),
    [scenario],
  );

  const handleScenarioChange = (event: SelectChangeEvent) => {
    setScenario(event.target.value as SimulatedBitcoinInstallerScenario);
  };

  return (
    <Box
      component="section"
      aria-labelledby="ledger-installer-poc-title"
      sx={{
        margin: "0 auto",
        maxWidth: 840,
        pt: { xs: 7, md: 0 },
        width: "100%",
      }}
    >
      <Alert
        severity="warning"
        variant="filled"
        sx={{ mb: 3 }}
        data-testid="ledger-installer-simulation-banner"
      >
        <AlertTitle>SIMULATION ONLY — NO LEDGER DEVICE IS USED</AlertTitle>
        This acceptance page cannot access hardware, contact Ledger services,
        use browser storage, or start Caravan signing. A successful result is
        simulated evidence for reviewing the interface only.
      </Alert>

      <Typography id="ledger-installer-poc-title" component="h1" variant="h4">
        Try the Ledger Bitcoin app installer
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3, mt: 1 }}>
        Choose a simulated outcome, then walk through the proposed install
        experience. No device is needed.
      </Typography>

      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel id="ledger-installer-scenario-label">
          Simulated scenario
        </InputLabel>
        <Select
          labelId="ledger-installer-scenario-label"
          id="ledger-installer-scenario"
          value={scenario}
          label="Simulated scenario"
          onChange={handleScenarioChange}
          inputProps={{ "aria-label": "Simulated scenario" }}
        >
          {SIMULATED_BITCOIN_INSTALLER_SCENARIOS.map((scenarioName) => (
            <MenuItem key={scenarioName} value={scenarioName}>
              {SIMULATED_BITCOIN_INSTALLER_SCENARIO_LABELS[scenarioName]}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <BitcoinAppInstallerFlow
        key={scenario}
        createInstaller={createInstaller}
        simulationOnly
      />
    </Box>
  );
}

export default LedgerBitcoinInstallerPocPage;
