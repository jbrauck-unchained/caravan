import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const labRoot = dirname(fileURLToPath(import.meta.url));

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
    baseURL: "http://127.0.0.1:4179",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    cwd: labRoot,
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4179/healthz",
  },
});
