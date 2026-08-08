import { resolve } from "node:path";

import {
  parseBrowserLabPort,
  parseLoopbackRequestTarget,
  resolvePublicFile,
} from "./scripts/server-policy.mjs";

const baseOrigin = "http://127.0.0.1:4179";
const publicRoot = resolve("/private/browser-lab/public");

describe("private browser-lab server policy", () => {
  it.each(["1", "4179", "65535"])("accepts TCP port %s", (value) => {
    expect(parseBrowserLabPort(value)).toBe(Number(value));
  });

  it.each(["", "0", "01", "1e3", "4179junk", "+4179", "65536", "999999"])(
    "rejects malformed TCP port %j",
    (value) => {
      expect(() => parseBrowserLabPort(value)).toThrow(
        "CARAVAN_LEDGER_BROWSER_LAB_PORT must be a valid TCP port.",
      );
    },
  );

  it.each([
    "/../build-evidence.json",
    "/%2e%2e/build-evidence.json",
    "/.%2e/build-evidence.json",
    "/assets%2fapp.js",
    "/assets%5capp.js",
    "/..%5cbuild-evidence.json",
    "/%00",
    "//foreign.example/path",
    "http://127.0.0.1:4179/absolute-form",
  ])("rejects malformed or traversing request target %j", (target) => {
    expect(() => parseLoopbackRequestTarget(target, baseOrigin)).toThrow();
  });

  it("keeps query parameters out of path validation", () => {
    const parsed = parseLoopbackRequestTarget(
      "/?fixture=chooser-cancelled",
      baseOrigin,
    );
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("fixture")).toBe("chooser-cancelled");
  });

  it("resolves valid public files beneath the owned root", () => {
    const parsed = parseLoopbackRequestTarget("/assets/app.js", baseOrigin);
    expect(resolvePublicFile(publicRoot, parsed.pathname)).toBe(
      resolve(publicRoot, "assets/app.js"),
    );
    expect(resolvePublicFile(publicRoot, "/")).toBe(
      resolve(publicRoot, "index.html"),
    );
  });
});
