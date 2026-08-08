import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testRoot, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const workRoot = mkdtempSync(
  join(tmpdir(), "caravan-ledger-documentation-contract-"),
);

const exampleDocuments = [
  resolve(packageRoot, "README.md"),
  resolve(repositoryRoot, "documentation/ledger/integration-guide.md"),
];

function markdownFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    });
}

const reviewedDocuments = [
  resolve(packageRoot, "README.md"),
  ...markdownFiles(resolve(repositoryRoot, "documentation/ledger")),
];

function run(command, args, cwd = repositoryRoot, environment = process.env) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}

function extractTypeScriptExamples(path) {
  const source = readFileSync(path, "utf8");
  const examples = [...source.matchAll(/^```ts\s*\n([\s\S]*?)^```\s*$/gm)]
    .map((match) => match[1])
    .filter((example) => example.includes('from "@caravan/ledger"'));
  if (examples.length === 0) {
    throw new Error(
      `No public @caravan/ledger TypeScript example found in ${path}`,
    );
  }
  return examples;
}

function assertSafeDocumentation(path) {
  const source = readFileSync(path, "utf8");
  const unsafeInstructions = [
    /(?:^|[.!?]\s+)(?:disclose|enter|paste|provide|share|submit|type|upload)\s+(?:(?:a|the|your)\s+)?(?:mnemonic|passphrase|pin|private keys?|recovery phrase|seed(?:\s+words?)?)\b/im,
    /(?:^|[.!?]\s+)(?:ignore|dismiss|bypass)\s+(?:the\s+)?(?:ledger screen|device warning|genuine check|security warning)\b/im,
    /\b(?:all|every)\s+(?:ledger\s+)?(?:device|model|browser|operating system|os)(?:s|es)?\s+(?:is|are)\s+supported\b/i,
  ];
  for (const pattern of unsafeInstructions) {
    if (pattern.test(source)) {
      throw new Error(
        `Unsafe or unsupported documentation claim in ${path}: ${pattern}`,
      );
    }
  }

  let localLinkTargets = 0;
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "");
    if (target === "" || target.startsWith("#")) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
      let external;
      try {
        external = new URL(target);
      } catch {
        throw new Error(`Malformed external documentation link in ${path}`);
      }
      if (external.protocol !== "https:" || external.hostname === "") {
        throw new Error(`Unsafe documentation link scheme in ${path}`);
      }
      continue;
    }
    const fileTarget = decodeURIComponent(
      target.split("#", 1)[0].split("?", 1)[0],
    );
    if (!existsSync(resolve(dirname(path), fileTarget))) {
      throw new Error(`Broken local documentation link in ${path}: ${target}`);
    }
    localLinkTargets += 1;
  }
  return localLinkTargets;
}

function packAndExtract() {
  const packDirectory = join(workRoot, "pack");
  const installedPackage = join(
    workRoot,
    "consumer",
    "node_modules",
    "@caravan",
    "ledger",
  );
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(installedPackage, { recursive: true });
  const environment = {
    ...process.env,
    npm_config_cache: join(workRoot, "npm-cache"),
  };
  const packed = JSON.parse(
    run(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        packDirectory,
      ],
      packageRoot,
      environment,
    ),
  );
  if (!Array.isArray(packed) || packed.length !== 1 || !packed[0]?.filename) {
    throw new Error(
      "Documentation contract did not produce one package tarball.",
    );
  }
  const tarball = join(packDirectory, packed[0].filename);
  run(
    "tar",
    ["-xzf", tarball, "--strip-components=1", "-C", installedPackage],
    packageRoot,
  );
  return { installedPackage, tarball: packed[0].filename };
}

try {
  const localLinkTargets = reviewedDocuments.reduce(
    (count, path) => count + assertSafeDocumentation(path),
    0,
  );

  const examples = exampleDocuments.flatMap((path) =>
    extractTypeScriptExamples(path).map((source) => ({ path, source })),
  );
  for (const { path, source } of examples) {
    if (
      /["'](?:@caravan\/ledger\/|@ledgerhq\/|rxjs(?:\/|["'])|xstate(?:\/|["']))/u.test(
        source,
      )
    ) {
      throw new Error(
        `Documentation example imports a forbidden SDK surface: ${path}`,
      );
    }
  }

  const { installedPackage, tarball } = packAndExtract();
  const consumerRoot = resolve(installedPackage, "../../..");
  const exampleRoot = join(consumerRoot, "examples");
  mkdirSync(exampleRoot, { recursive: true });
  examples.forEach(({ source }, index) => {
    writeFileSync(join(exampleRoot, `example-${index + 1}.ts`), source);
  });
  writeFileSync(
    join(consumerRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
          types: [],
        },
        include: ["examples/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(
    process.execPath,
    [resolve(repositoryRoot, "node_modules/typescript/bin/tsc"), "-p", "."],
    consumerRoot,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        compiledExamples: examples.length,
        localLinkTargetsChecked: localLinkTargets,
        packageArtifact: tarball,
        packageSource: "packed-tarball",
        reviewedDocuments: reviewedDocuments.length,
        unsafeInstructionPatterns: "absent",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(workRoot, { force: true, recursive: true });
}
