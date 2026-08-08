const denyGlobalRead = (name) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);

  if (original && !original.configurable) {
    throw new Error(`Cannot instrument non-configurable global: ${name}`);
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error(`Built package read ${name} during module evaluation`);
    },
  });
};

const denyConsoleCall = (name) => {
  Object.defineProperty(console, name, {
    configurable: true,
    value() {
      throw new Error(`Built package called console.${name} during import`);
    },
    writable: true,
  });
};

denyGlobalRead("window");
denyGlobalRead("navigator");
denyGlobalRead("fetch");
denyGlobalRead("WebSocket");
denyGlobalRead("XMLHttpRequest");
denyGlobalRead("EventSource");
for (const method of ["debug", "error", "info", "log", "warn"]) {
  denyConsoleCall(method);
}

// Use the package self-reference so this also exercises the public exports map.
const resolvedEntry = import.meta.resolve("@caravan/ledger");
if (!resolvedEntry.endsWith("/dist/index.js")) {
  throw new Error(`Node resolved the wrong package entry: ${resolvedEntry}`);
}
const packageEntry = await import("@caravan/ledger");
if (
  JSON.stringify(Object.keys(packageEntry).sort()) !==
  JSON.stringify(
    [
      "BitcoinInstallerError",
      "createBitcoinAppInstaller",
      "getBitcoinInstallerSupport",
    ].sort(),
  )
) {
  throw new Error("Built Node entry exports changed.");
}
const installer = packageEntry.createBitcoinAppInstaller();
await installer.prepare().then(
  () => {
    throw new Error("Neutral installer unexpectedly prepared a device.");
  },
  (error) => {
    if (
      error?.code !== "unsupported-environment" ||
      error?.phase !== "idle"
    ) {
      throw error;
    }
  },
);
await installer.dispose();
