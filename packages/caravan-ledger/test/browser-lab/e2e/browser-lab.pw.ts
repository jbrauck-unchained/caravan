import { expect, test as base, type Page } from "@playwright/test";

const test = base.extend<{ isolationViolations: string[] }>({
  isolationViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        violations.push(`console.${message.type()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => {
        violations.push(`pageerror: ${error.name}`);
      });
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.hostname !== "127.0.0.1" &&
          url.hostname !== "localhost"
        ) {
          violations.push(`non-loopback request: ${url.origin}`);
        }
      });
      page.on("requestfailed", (request) => {
        violations.push(`request failed: ${request.url()}`);
      });
      page.on("dialog", (dialog) => {
        violations.push(`unexpected dialog: ${dialog.type()}`);
        void dialog.dismiss();
      });

      await use(violations);
      expect(violations, "unexpected console or network activity").toEqual([]);
    },
    { auto: true },
  ],
});

async function openFixture(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?fixture=${fixture}`);
  await expect(page.locator("body")).toHaveAttribute("data-lab-ready", "true");
}

test("support probing is inert for supported, missing, malformed, and throwing HID", async ({
  page,
}) => {
  for (const [fixture, expected] of [
    ["supported", { supported: true }],
    ["no-hid", { supported: false, reason: "webhid-unavailable" }],
    ["malformed", { supported: false, reason: "webhid-unavailable" }],
    ["throwing", { supported: false, reason: "webhid-unavailable" }],
  ] as const) {
    await openFixture(page, fixture);
    const observed = await page.evaluate(() => ({
      support: window.__CARAVAN_LEDGER_BROWSER_LAB__.support,
      getDevicesCalls: window.__CARAVAN_LEDGER_HID_FACADE__.getDevicesCalls,
      requestDeviceCalls:
        window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
    }));
    expect(observed).toEqual({
      support: expected,
      getDevicesCalls: 0,
      requestDeviceCalls: 0,
    });
  }
});

test("a direct click reaches the chooser synchronously; cancel settles and retry needs another click", async ({
  page,
}) => {
  await openFixture(page, "supported");

  await page.getByTestId("prepare").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceActivation,
    ),
  ).toEqual([true]);
  await expect(page.getByTestId("events")).toContainText("selecting-device");

  await page.getByTestId("prepare").dispatchEvent("click");
  expect(
    await page.evaluate(
      () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
    ),
  ).toBe(1);

  await page.getByTestId("cancel").click();
  await expect(page.locator("body")).toHaveAttribute("data-phase", "cancelled");
  expect(
    await page.evaluate(
      () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
    ),
  ).toBe(1);

  await page.getByTestId("prepare").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
      ),
    )
    .toBe(2);
  await page.getByTestId("cancel").click();
});

test("chooser dismissal disposes the failed workflow before a fresh-click retry", async ({
  page,
}) => {
  await openFixture(page, "chooser-cancelled");

  await page.getByTestId("prepare").click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__CARAVAN_LEDGER_BROWSER_LAB__.workflowCount),
    )
    .toBe(2);
  const firstAttempt = await page.evaluate(() => ({
    disposedWorkflowCount:
      window.__CARAVAN_LEDGER_BROWSER_LAB__.disposedWorkflowCount,
    phases: window.__CARAVAN_LEDGER_BROWSER_LAB__.phases,
    requestDeviceActivation:
      window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceActivation,
    requestDeviceCalls: window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
  }));
  expect(firstAttempt).toMatchObject({
    disposedWorkflowCount: 1,
    requestDeviceActivation: [true],
    requestDeviceCalls: 1,
  });
  expect(firstAttempt.phases.slice(-3)).toEqual(["failed", "disposed", "idle"]);
  await expect(page.getByTestId("prepare")).toBeEnabled();

  await page.getByTestId("prepare").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
      ),
    )
    .toBe(2);
  expect(
    await page.evaluate(
      () => window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceActivation,
    ),
  ).toEqual([true, true]);
  await page.getByTestId("cancel").click();
});

test("first dynamic import after click is visibly blocked as invalid", async ({
  page,
}) => {
  await openFixture(page, "supported");

  await page.getByTestId("late-import").click();
  await expect(page.getByTestId("late-result")).toHaveText(
    "blocked-after-dynamic-import",
  );
  const observed = await page.evaluate(() => ({
    activation: window.__CARAVAN_LEDGER_BROWSER_LAB__.lateImportActivation,
    invokedPrepare:
      window.__CARAVAN_LEDGER_BROWSER_LAB__.lateImportInvokedPrepare,
    requestDeviceCalls: window.__CARAVAN_LEDGER_HID_FACADE__.requestDeviceCalls,
  }));
  expect(observed).toEqual({
    activation: false,
    invokedPrepare: false,
    requestDeviceCalls: 0,
  });
});

test("handoff result alone never starts WebUSB and reconnect-required stays disabled", async ({
  page,
}) => {
  await openFixture(page, "supported");

  await page.getByTestId("inject-ready").click();
  await expect(page.getByTestId("continue-webusb")).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.__CARAVAN_LEDGER_BROWSER_LAB__.webUsbCalls,
    ),
  ).toBe(0);

  await page.getByTestId("continue-webusb").click();
  expect(
    await page.evaluate(() => ({
      activations: window.__CARAVAN_LEDGER_BROWSER_LAB__.webUsbActivation,
      calls: window.__CARAVAN_LEDGER_BROWSER_LAB__.webUsbCalls,
    })),
  ).toEqual({ activations: [true], calls: 1 });

  await openFixture(page, "supported");
  await page.getByTestId("inject-reconnect").click();
  await expect(page.getByTestId("continue-webusb")).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.__CARAVAN_LEDGER_BROWSER_LAB__.webUsbCalls,
    ),
  ).toBe(0);
});
