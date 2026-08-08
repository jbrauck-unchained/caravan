import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const labRoot = dirname(fileURLToPath(import.meta.url));
const portValue = process.env.CARAVAN_LEDGER_BROWSER_LAB_PORT ?? "4179";
if (!/^[1-9][0-9]{0,4}$/u.test(portValue) || Number(portValue) > 65535) {
  throw new Error("CARAVAN_LEDGER_BROWSER_LAB_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${portValue}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "line",
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    cwd: labRoot,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/healthz`,
  },
});
