import {
  createReadStream,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { buildBrowserLab } from "./build.mjs";
import {
  parseBrowserLabPort,
  parseLoopbackRequestTarget,
  resolvePublicFile,
} from "./server-policy.mjs";

const host = "127.0.0.1";
const port = parseBrowserLabPort(
  process.env.CARAVAN_LEDGER_BROWSER_LAB_PORT ?? "4179",
);

const workRoot = mkdtempSync(join(tmpdir(), "caravan-ledger-browser-server-"));
const publicRoot = join(workRoot, "public");
let buildResult;
try {
  buildResult = await buildBrowserLab({ outputDirectory: publicRoot });
} catch (error) {
  rmSync(workRoot, { force: true, recursive: true });
  throw error;
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }

  let requestUrl;
  try {
    requestUrl = parseLoopbackRequestTarget(
      request.url ?? "/",
      `http://${host}:${port}`,
    );
  } catch {
    response.writeHead(404).end();
    return;
  }
  if (requestUrl.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  let filePath;
  try {
    filePath = resolvePublicFile(publicRoot, requestUrl.pathname);
  } catch {
    response.writeHead(404).end();
    return;
  }

  try {
    if (!statSync(filePath).isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type":
        contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else {
      const stream = createReadStream(filePath);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    }
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `Private browser lab listening on http://${host}:${port}\n`,
  );
});

let shutdownStarted = false;

function removeTemporaryFiles() {
  let cleaned = true;
  try {
    rmSync(buildResult.workRoot, { force: true, recursive: true });
  } catch {
    cleaned = false;
  }
  try {
    rmSync(workRoot, { force: true, recursive: true });
  } catch {
    cleaned = false;
  }
  return cleaned && !existsSync(buildResult.workRoot) && !existsSync(workRoot);
}

function close(exitCode = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const finish = () => {
    const cleaned = removeTemporaryFiles();
    if (!cleaned) {
      process.stderr.write(
        "Private browser-lab temporary cleanup was incomplete.\n",
      );
    }
    process.exit(cleaned ? exitCode : 1);
  };
  if (server.listening) server.close(finish);
  else finish();
}

process.on("SIGINT", () => close(0));
process.on("SIGTERM", () => close(0));
server.on("error", () => {
  process.stderr.write("Private browser-lab server failed to listen.\n");
  close(1);
});
