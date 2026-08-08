import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.CARAVAN_LEDGER_RUN_NATIVE !== "1") {
  process.stderr.write(
    "NOT RUN: native Chromium evidence requires CARAVAN_LEDGER_RUN_NATIVE=1 and the exact Playwright-managed browser already installed on this machine. No browser will be downloaded.\n",
  );
  process.exit(1);
}

const { chromium } = await import("playwright");
const executable = chromium.executablePath();
if (!existsSync(executable)) {
  process.stderr.write(
    `Native Chromium gate requested, but Playwright's exact browser is absent: ${executable}\n`,
  );
  process.stderr.write(
    "Install it through the repository's approved dependency workflow, then rerun. This fixture never downloads browsers.\n",
  );
  process.exit(1);
}

const cli = resolve(
  labRoot,
  "../../../../node_modules/@playwright/test/cli.js",
);
const result = spawnSync(
  process.execPath,
  [cli, "test", "--config", resolve(labRoot, "playwright.config.ts")],
  {
    cwd: labRoot,
    env: process.env,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
