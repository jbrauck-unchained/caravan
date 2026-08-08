import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function availableLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a loopback browser-lab port."));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

if (process.env.CARAVAN_LEDGER_RUN_NATIVE !== "1") {
  process.stderr.write(
    "NOT RUN: the Playwright Chromium facade gate requires CARAVAN_LEDGER_RUN_NATIVE=1 and its exact managed browser already installed on this machine. No browser will be downloaded.\n",
  );
  process.exit(1);
}

const { chromium } = await import("@playwright/test");
const executable = chromium.executablePath();
if (!existsSync(executable)) {
  process.stderr.write(
    `Playwright Chromium facade gate requested, but its exact browser is absent: ${executable}\n`,
  );
  process.stderr.write(
    "Install it through the repository's approved dependency workflow, then rerun. This fixture never downloads browsers.\n",
  );
  process.exit(1);
}

const cli = require.resolve("@playwright/test/cli");
const port =
  process.env.CARAVAN_LEDGER_BROWSER_LAB_PORT ??
  String(await availableLoopbackPort());
const result = spawnSync(
  process.execPath,
  [cli, "test", "--config", resolve(labRoot, "playwright.config.ts")],
  {
    cwd: labRoot,
    env: {
      ...process.env,
      CARAVAN_LEDGER_BROWSER_LAB_PORT: port,
    },
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
