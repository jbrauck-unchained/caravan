import dns from "node:dns";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const LOOPBACK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

export class LedgerContractNetworkPolicyError extends Error {
  constructor(kind) {
    super(`Ledger contract network policy denied ${kind}.`);
    this.name = "LedgerContractNetworkPolicyError";
    this.code = "LEDGER_CONTRACT_NETWORK_DENIED";
  }
}

function deny(kind) {
  throw new LedgerContractNetworkPolicyError(kind);
}

function normalizedHost(value, kind) {
  if (typeof value !== "string" || value.length === 0) deny(kind);
  const candidate =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const normalized = candidate.toLowerCase();
  if (!LOOPBACK_HOSTS.has(normalized)) deny(kind);
  return normalized;
}

function validatedPort(value, kind) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9][0-9]{0,4}$/u.test(text)) {
    deny(kind);
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port > 65535) deny(kind);
  return port;
}

export function assertLoopbackUrl(value, kind = "URL") {
  let parsed;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    deny(kind);
  }
  if (
    !LOOPBACK_PROTOCOLS.has(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    deny(kind);
  }
  normalizedHost(parsed.hostname, kind);
  validatedPort(parsed.port, kind);
  return parsed;
}

function optionsFromHttpArguments(args, protocol, kind) {
  const [target, options] = args;
  let parsed;
  let requestOptions;

  if (target instanceof URL) {
    parsed = assertLoopbackUrl(target, kind);
    requestOptions = options;
  } else if (typeof target === "string" && !target.startsWith("/")) {
    parsed = assertLoopbackUrl(target, kind);
    requestOptions = options;
  } else {
    requestOptions =
      target && typeof target === "object" && !(target instanceof URL)
        ? target
        : options;
    if (!requestOptions || typeof requestOptions !== "object") deny(kind);
    if (requestOptions.socketPath !== undefined) deny(kind);
    const host = requestOptions.hostname ?? requestOptions.host;
    normalizedHost(host, kind);
    validatedPort(requestOptions.port, kind);
    const requestProtocol = requestOptions.protocol ?? protocol;
    if (requestProtocol !== protocol) deny(kind);
  }

  if (requestOptions && typeof requestOptions === "object") {
    if (
      requestOptions.socketPath !== undefined ||
      requestOptions.lookup !== undefined ||
      requestOptions.createConnection !== undefined ||
      requestOptions.agent !== undefined ||
      String(requestOptions.method ?? "GET").toUpperCase() === "CONNECT"
    ) {
      deny(kind);
    }
    if (parsed) {
      if (
        requestOptions.hostname !== undefined ||
        requestOptions.host !== undefined ||
        requestOptions.port !== undefined ||
        requestOptions.protocol !== undefined
      ) {
        deny(kind);
      }
    }
  }
}

function optionsFromSocketArguments(args, kind) {
  const [target, host] = args;
  if (typeof target === "number" || typeof target === "string") {
    validatedPort(target, kind);
    normalizedHost(host, kind);
  } else {
    if (!target || typeof target !== "object" || target.path !== undefined) {
      deny(kind);
    }
    normalizedHost(target.host, kind);
    validatedPort(target.port, kind);
  }
  for (const options of args.filter(
    (value) => value && typeof value === "object",
  )) {
    if (
      options.path !== undefined ||
      options.lookup !== undefined ||
      options.onread !== undefined ||
      options.fd !== undefined ||
      options.socket !== undefined
    ) {
      deny(kind);
    }
    if (options.servername !== undefined) {
      normalizedHost(options.servername, kind);
    }
  }
}

function replace(target, key, value, restorers) {
  const original = target[key];
  target[key] = value;
  restorers.push(() => {
    target[key] = original;
  });
}

function guardCall(original, validate) {
  return function guardedCall(...args) {
    validate(args);
    return Reflect.apply(original, this, args);
  };
}

function guardConstructor(Original, validate) {
  return new Proxy(Original, {
    construct(target, args, newTarget) {
      validate(args);
      return Reflect.construct(target, args, newTarget);
    },
  });
}

/**
 * Installs a process-local defense-in-depth policy for a reviewed Node runner.
 * It is intentionally strict: endpoints must use literal loopback addresses and
 * explicit ports; DNS, proxy/custom connection hooks, and Unix sockets are
 * denied. An approved release runner still needs independently reviewed
 * process/container isolation because JavaScript interception is not an OS
 * firewall.
 */
export function installLoopbackOnlyNetworkPolicy() {
  const restorers = [];

  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    replace(
      globalThis,
      "fetch",
      guardCall(originalFetch, ([target, options]) => {
        assertLoopbackUrl(target, "fetch");
        if (
          options &&
          typeof options === "object" &&
          (options.dispatcher !== undefined || options.agent !== undefined)
        ) {
          deny("fetch");
        }
      }),
      restorers,
    );
  }

  for (const [module, key, protocol, kind] of [
    [http, "request", "http:", "HTTP request"],
    [http, "get", "http:", "HTTP request"],
    [https, "request", "https:", "HTTPS request"],
    [https, "get", "https:", "HTTPS request"],
  ]) {
    replace(
      module,
      key,
      guardCall(module[key], (args) =>
        optionsFromHttpArguments(args, protocol, kind),
      ),
      restorers,
    );
  }

  for (const [module, key, kind] of [
    [net, "connect", "TCP connection"],
    [net, "createConnection", "TCP connection"],
    [tls, "connect", "TLS connection"],
  ]) {
    replace(
      module,
      key,
      guardCall(module[key], (args) => optionsFromSocketArguments(args, kind)),
      restorers,
    );
  }

  replace(
    http2,
    "connect",
    guardCall(http2.connect, ([authority, options]) => {
      assertLoopbackUrl(authority, "HTTP/2 connection");
      if (
        options &&
        typeof options === "object" &&
        (options.createConnection !== undefined ||
          options.lookup !== undefined ||
          options.socket !== undefined)
      ) {
        deny("HTTP/2 connection");
      }
    }),
    restorers,
  );

  for (const key of [
    "lookup",
    "resolve",
    "resolve4",
    "resolve6",
    "resolveAny",
    "resolveCaa",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "reverse",
  ]) {
    if (typeof dns[key] === "function") {
      replace(dns, key, () => deny("DNS lookup"), restorers);
    }
    if (typeof dns.promises?.[key] === "function") {
      replace(dns.promises, key, () => deny("DNS lookup"), restorers);
    }
  }

  for (const key of ["WebSocket", "EventSource"]) {
    if (typeof globalThis[key] === "function") {
      const Original = globalThis[key];
      replace(
        globalThis,
        key,
        guardConstructor(Original, ([target]) => {
          assertLoopbackUrl(target, key);
        }),
        restorers,
      );
    }
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const restore of restorers.reverse()) restore();
  };
}

function expectPolicyDenial(action, label) {
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      return result.then(
        () => {
          throw new Error(`${label} unexpectedly reached its adapter.`);
        },
        (error) => {
          if (!(error instanceof LedgerContractNetworkPolicyError)) throw error;
        },
      );
    }
  } catch (error) {
    if (error instanceof LedgerContractNetworkPolicyError) return undefined;
    throw error;
  }
  throw new Error(`${label} unexpectedly reached its adapter.`);
}

/**
 * Exercises the installed policy with inert adapters. Even if an assertion is
 * broken, this self-test cannot make a real network or DNS call.
 */
export async function runNetworkPolicySelfTest() {
  const replacements = [];
  const hasWebSocket = typeof globalThis.WebSocket === "function";
  let adapterCalls = 0;
  const inertCall = () => {
    adapterCalls += 1;
    return { inert: true };
  };
  const inertAsyncCall = async () => {
    adapterCalls += 1;
    return { inert: true };
  };
  class InertSocket {
    constructor() {
      adapterCalls += 1;
    }
  }

  try {
    if (typeof globalThis.fetch === "function") {
      replace(globalThis, "fetch", inertAsyncCall, replacements);
    }
    for (const [module, keys] of [
      [http, ["request", "get"]],
      [https, ["request", "get"]],
      [net, ["connect", "createConnection"]],
      [tls, ["connect"]],
      [http2, ["connect"]],
    ]) {
      for (const key of keys) replace(module, key, inertCall, replacements);
    }
    if (typeof dns.lookup === "function") {
      replace(dns, "lookup", inertCall, replacements);
    }
    if (typeof dns.promises?.lookup === "function") {
      replace(dns.promises, "lookup", inertAsyncCall, replacements);
    }
    if (typeof globalThis.WebSocket === "function") {
      replace(globalThis, "WebSocket", InertSocket, replacements);
    }

    const restorePolicy = installLoopbackOnlyNetworkPolicy();
    try {
      assertLoopbackUrl("http://127.0.0.1:49152/health", "self-test");
      assertLoopbackUrl("ws://[::1]:49153/device", "self-test");

      const beforeDeniedCalls = adapterCalls;
      await expectPolicyDenial(
        () => globalThis.fetch("https://manager.api.live.ledger.com:443"),
        "live Ledger fetch",
      );
      await expectPolicyDenial(
        () => https.request("https://manager.api.live.ledger.com:443"),
        "live Ledger HTTPS request",
      );
      await expectPolicyDenial(
        () => net.connect(443, "manager.api.live.ledger.com"),
        "live Ledger TCP connection",
      );
      await expectPolicyDenial(
        () => dns.lookup("manager.api.live.ledger.com", () => {}),
        "live Ledger DNS lookup",
      );
      await expectPolicyDenial(
        () => dns.promises.lookup("manager.api.live.ledger.com"),
        "live Ledger promise DNS lookup",
      );
      await expectPolicyDenial(
        () => http2.connect("https://manager.api.live.ledger.com:443"),
        "live Ledger HTTP/2 connection",
      );
      if (hasWebSocket) {
        await expectPolicyDenial(
          () =>
            new globalThis.WebSocket(
              "wss://manager.api.live.ledger.com:443/device",
            ),
          "live Ledger WebSocket",
        );
      }
      await expectPolicyDenial(
        () =>
          http.request({
            hostname: "127.0.0.1",
            port: 49152,
            lookup: inertCall,
          }),
        "custom DNS hook",
      );
      await expectPolicyDenial(
        () =>
          globalThis.fetch("http://127.0.0.1:49152/health", {
            dispatcher: {},
          }),
        "custom fetch dispatcher",
      );
      await expectPolicyDenial(
        () => http.request("http://localhost:49152/health"),
        "hostname loopback request",
      );
      await expectPolicyDenial(
        () => http.request("http://127.0.0.1/health"),
        "implicit-port request",
      );
      if (adapterCalls !== beforeDeniedCalls) {
        throw new Error("A denied network self-test reached an adapter.");
      }

      await globalThis.fetch("http://127.0.0.1:49152/health");
      http.request({ hostname: "127.0.0.1", port: 49152 });
      net.connect({ host: "::1", port: 49153 });
      if (hasWebSocket) {
        new globalThis.WebSocket("ws://127.0.0.1:49153/device");
      }
      const expectedLoopbackCalls = hasWebSocket ? 4 : 3;
      if (adapterCalls !== beforeDeniedCalls + expectedLoopbackCalls) {
        throw new Error(
          "Loopback network self-test did not reach inert adapters.",
        );
      }
    } finally {
      restorePolicy();
    }
  } finally {
    for (const restore of replacements.reverse()) restore();
  }
}
