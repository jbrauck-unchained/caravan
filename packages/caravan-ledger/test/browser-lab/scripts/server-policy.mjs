import { join, normalize, sep } from "node:path";

export function parseBrowserLabPort(value) {
  if (!/^[1-9][0-9]{0,4}$/u.test(value)) {
    throw new Error(
      "CARAVAN_LEDGER_BROWSER_LAB_PORT must be a valid TCP port.",
    );
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error(
      "CARAVAN_LEDGER_BROWSER_LAB_PORT must be a valid TCP port.",
    );
  }
  return port;
}

export function parseLoopbackRequestTarget(rawTarget, baseOrigin) {
  if (typeof rawTarget !== "string" || !rawTarget.startsWith("/")) {
    throw new Error("invalid request target");
  }

  const rawPath = rawTarget.split(/[?#]/u, 1)[0];
  for (const rawSegment of rawPath.split("/")) {
    const decodedSegment = decodeURIComponent(rawSegment);
    if (
      decodedSegment === "." ||
      decodedSegment === ".." ||
      decodedSegment.includes("/") ||
      decodedSegment.includes("\\") ||
      decodedSegment.includes("\0")
    ) {
      throw new Error("invalid request path");
    }
  }

  const requestUrl = new URL(rawTarget, baseOrigin);
  if (requestUrl.origin !== baseOrigin) throw new Error("foreign origin");
  return requestUrl;
}

export function resolvePublicFile(publicRoot, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  if (decodedPath.includes("\0")) throw new Error("invalid request path");
  const relativePath =
    decodedPath === "/"
      ? "index.html"
      : normalize(decodedPath).replace(/^[/\\]+/u, "");
  const filePath = join(publicRoot, relativePath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    throw new Error("request path escaped the public root");
  }
  return filePath;
}
