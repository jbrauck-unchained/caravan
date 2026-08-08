import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(scriptDirectory, "..");
const packageRoot = resolve(labRoot, "../..");
const repositoryRoot = resolve(packageRoot, "../..");

function run(command, args, cwd, environment = process.env) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createEmptyDirectory(path) {
  if (existsSync(path)) {
    throw new Error(`Browser-lab output already exists: ${path}`);
  }
  mkdirSync(path, { recursive: true });
}

function removeOwnedDirectory(path) {
  try {
    rmSync(path, { force: true, recursive: true });
  } catch {
    return false;
  }
  return !existsSync(path);
}

function packBuiltPackage(workRoot) {
  const npmCache = join(workRoot, "npm-cache");
  const environment = {
    ...process.env,
    PATH: [dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(delimiter),
    npm_config_cache: npmCache,
  };
  const npmCli = process.env.CARAVAN_LEDGER_NPM_CLI;
  const runNpm = (args) =>
    npmCli
      ? run(process.execPath, [npmCli, ...args], packageRoot, environment)
      : run("npm", args, packageRoot, environment);

  runNpm(["run", "build", "--silent"]);

  const packDirectory = join(workRoot, "pack");
  const unpackDirectory = join(workRoot, "unpacked");
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(unpackDirectory, { recursive: true });

  const packed = JSON.parse(
    runNpm([
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      packDirectory,
    ]),
  );
  if (!Array.isArray(packed) || packed.length !== 1 || !packed[0]?.filename) {
    throw new Error("npm pack did not return exactly one local artifact.");
  }

  const tarball = join(packDirectory, packed[0].filename);
  const entries = run("tar", ["-tzf", tarball], packageRoot)
    .split("\n")
    .filter(Boolean);
  if (!entries.includes("package/dist/browser.js")) {
    throw new Error("Packed package is missing dist/browser.js.");
  }
  if (!entries.includes("package/dist/index.js")) {
    throw new Error("Packed package is missing dist/index.js.");
  }
  if (entries.some((entry) => entry.startsWith("package/test/"))) {
    throw new Error(
      "Private browser-lab files leaked into the packed package.",
    );
  }

  run("tar", ["-xzf", tarball, "-C", unpackDirectory], packageRoot);
  return {
    browserEntry: join(unpackDirectory, "package/dist/browser.js"),
    indexEntry: join(unpackDirectory, "package/dist/index.js"),
    packageFilename: packed[0].filename,
  };
}

function verifyPackedSsrImport(indexEntry) {
  const entryUrl = pathToFileURL(indexEntry).href;
  const source = `
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined });
    const ledger = await import(${JSON.stringify(entryUrl)});
    const support = ledger.getBitcoinInstallerSupport();
    if (JSON.stringify(support) !== JSON.stringify({ supported: false, reason: "not-browser" })) {
      throw new Error("Packed SSR support result changed: " + JSON.stringify(support));
    }
  `;
  run(process.execPath, ["--input-type=module", "--eval", source], packageRoot);
}

export async function buildBrowserLab(options = {}) {
  const workRoot = mkdtempSync(join(tmpdir(), "caravan-ledger-browser-lab-"));
  const outputDirectory = options.outputDirectory
    ? resolve(options.outputDirectory)
    : join(workRoot, "public");
  let outputCreated = false;
  try {
    createEmptyDirectory(outputDirectory);
    outputCreated = true;
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });

    const packed = packBuiltPackage(workRoot);
    verifyPackedSsrImport(packed.indexEntry);

    const packedPackagePlugin = {
      name: "packed-caravan-ledger",
      setup(esbuild) {
        esbuild.onResolve({ filter: /^@caravan\/ledger$/ }, () => ({
          path: packed.browserEntry,
        }));
      },
    };
    const nodePaths = [
      join(packageRoot, "node_modules"),
      join(repositoryRoot, "node_modules"),
    ];

    await build({
      absWorkingDir: labRoot,
      bundle: true,
      chunkNames: "chunks/[name]-[hash]",
      entryNames: "app",
      entryPoints: [join(labRoot, "src/app.ts")],
      format: "esm",
      nodePaths,
      outdir: join(outputDirectory, "assets"),
      platform: "browser",
      plugins: [packedPackagePlugin],
      sourcemap: false,
      splitting: true,
      target: ["es2022"],
    });

    await build({
      absWorkingDir: labRoot,
      bundle: true,
      entryPoints: [join(labRoot, "src/hid-facade.ts")],
      format: "iife",
      outfile: join(outputDirectory, "hid-facade.js"),
      platform: "browser",
      sourcemap: false,
      target: ["es2022"],
    });

    copyFileSync(
      join(labRoot, "index.html"),
      join(outputDirectory, "index.html"),
    );
    const evidence = Object.freeze({
      artifact: packed.packageFilename,
      browserEntry: "package/dist/browser.js",
      privateLabIncludedInArtifact: false,
      ssrImport: "passed",
    });
    writeFileSync(
      join(outputDirectory, "build-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );

    return Object.freeze({ outputDirectory, workRoot, evidence });
  } catch (error) {
    if (outputCreated) {
      removeOwnedDirectory(outputDirectory);
    }
    removeOwnedDirectory(workRoot);
    if (
      (outputCreated && existsSync(outputDirectory)) ||
      existsSync(workRoot)
    ) {
      throw new Error(
        "Browser-lab build failed and temporary cleanup was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }
}

function parseOutputArgument(args) {
  if (args.length === 0) return undefined;
  if (
    args.length !== 2 ||
    args[0] !== "--out" ||
    !args[1] ||
    args[1].startsWith("--")
  ) {
    throw new Error("Usage: build.mjs [--out <new-directory>]");
  }
  return args[1];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const requestedOutput = parseOutputArgument(process.argv.slice(2));
  const result = await buildBrowserLab({
    outputDirectory: requestedOutput,
  });
  let evidence;
  let evidenceFailure;
  try {
    evidence = readFileSync(
      join(result.outputDirectory, "build-evidence.json"),
      "utf8",
    );
  } catch (error) {
    evidenceFailure = error;
  }
  const cleaned = removeOwnedDirectory(result.workRoot);
  if (evidenceFailure) {
    if (!cleaned) {
      throw new Error(
        "Browser-lab evidence read failed and temporary cleanup was incomplete.",
        { cause: evidenceFailure },
      );
    }
    throw evidenceFailure;
  }
  if (!cleaned) {
    throw new Error("Browser-lab temporary build directory was not removed.");
  }
  process.stdout.write(
    requestedOutput
      ? `Packed private browser lab retained at ${result.outputDirectory}\n`
      : "Packed private browser lab verified; temporary output removed.\n",
  );
  process.stdout.write(evidence);
}
