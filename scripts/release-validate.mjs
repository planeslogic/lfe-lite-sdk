import { spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const expectedVersion = "0.1.0-rc.2";
const expectedCoreVersion = "v0.1.4";
const expectedCoreCommit = "d9a97cb";

function fail(message) {
  throw new Error(`D5 release validation failed: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    fail(`${command} ${args.join(" ")} exited with ${result.status}`);
  }

  return options.capture ? (result.stdout ?? "").trim() : "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkPackageMetadata() {
  const pkg = readJson(join(repoRoot, "package.json"));

  if (pkg.name !== "@planeslogic/lfe-lite") {
    fail(`unexpected package name: ${pkg.name}`);
  }
  if (pkg.version !== expectedVersion) {
    fail(`package version must be ${expectedVersion}, got ${pkg.version}`);
  }
  if (pkg.private === true || pkg.private === "true") {
    fail("package must not be marked private");
  }
  if (pkg.license !== "UNLICENSED") {
    fail(`release-candidate legal metadata must be UNLICENSED, got ${pkg.license}`);
  }
  if (pkg.type !== "module") {
    fail("package must remain ESM");
  }
  if (pkg.main !== "./dist/index.js" || pkg.types !== "./dist/index.d.ts") {
    fail("main/types entry points do not match D5 contract");
  }

  const rootExport = pkg.exports?.["."];
  if (
    !rootExport ||
    rootExport.import !== "./dist/index.js" ||
    rootExport.types !== "./dist/index.d.ts"
  ) {
    fail("package root export does not match D5 contract");
  }

  if (Object.keys(pkg.exports).length !== 1) {
    fail("package must expose only the root public export");
  }

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  if (files.length !== 2 || !files.includes("dist") || !files.includes("README.md")) {
    fail("package files allowlist must contain only dist and README.md");
  }

  const nodeRange = pkg.engines?.node;
  if (nodeRange !== ">=22") {
    fail(`release tooling engine must be Node >=22, got ${nodeRange}`);
  }

  const source = readFileSync(join(repoRoot, "src/index.ts"), "utf8");
  if (!source.includes(`LFE_LITE_SDK_VERSION = "${expectedVersion}"`)) {
    fail("LFE_LITE_SDK_VERSION does not match package version");
  }

  const coreSource = readFileSync(join(repoRoot, "internal/core-version.ts"), "utf8");
  if (!coreSource.includes(`LFE_LITE_CORE_VERSION = "${expectedCoreVersion}"`)) {
    fail("Core version projection changed");
  }
  if (!coreSource.includes(`LFE_LITE_CORE_COMMIT = "${expectedCoreCommit}"`)) {
    fail("Core commit projection changed");
  }
}

function checkToolVersions() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    fail(`Node >=22 required for release tooling, got ${process.versions.node}`);
  }

  const npmVersion = run("npm", ["--version"], { capture: true });
  const wasmPackVersion = run("wasm-pack", ["--version"], { capture: true });

  console.log(`SDK version:       ${expectedVersion}`);
  console.log(`Core version:      ${expectedCoreVersion}`);
  console.log(`Core commit:       ${expectedCoreCommit}`);
  console.log(`Node version:      ${process.versions.node}`);
  console.log(`npm version:       ${npmVersion}`);
  console.log(`wasm-pack version: ${wasmPackVersion}`);
}

function walkFiles(root, relative = "") {
  const current = join(root, relative);
  const entries = readFileSystemDirectory(current);
  const files = [];

  for (const entry of entries) {
    const next = relative ? `${relative}/${entry}` : entry;
    const full = join(root, next);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(root, next));
    } else if (stat.isFile()) {
      files.push(next.replaceAll("\\", "/"));
    }
  }

  return files;
}

function readFileSystemDirectory(path) {
  return readdirSync(path);
}

function assertNoStandaloneWasm() {
  const dist = join(repoRoot, "dist");
  if (!existsSync(dist)) {
    fail("dist directory is missing after build");
  }

  const files = walkFiles(dist);
  const wasm = files.filter((path) => path.toLowerCase().endsWith(".wasm"));
  if (wasm.length > 0) {
    fail(`standalone WASM emitted in dist: ${wasm.join(", ")}`);
  }
}

function inspectPackedFiles(packEntry) {
  const paths = packEntry.files.map((file) => file.path.replaceAll("\\", "/"));

  const required = [
    "package.json",
    "README.md",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/worker.js",
  ];

  for (const requiredPath of required) {
    if (!paths.includes(requiredPath)) {
      fail(`packed tarball missing required file: ${requiredPath}`);
    }
  }

  const exactAllowed = new Set(["package.json", "README.md", "LICENSE", "NOTICE"]);

  for (const path of paths) {
    const lower = path.toLowerCase();

    if (!(exactAllowed.has(path) || path.startsWith("dist/"))) {
      fail(`unexpected file in npm tarball: ${path}`);
    }

    if (
      lower.endsWith(".wasm") ||
      lower.endsWith(".pem") ||
      lower.endsWith(".key") ||
      lower.endsWith(".crt") ||
      lower.endsWith(".p12") ||
      lower.endsWith(".pfx")
    ) {
      fail(`forbidden release artifact in npm tarball: ${path}`);
    }

    if (
      lower === ".env" ||
      lower.startsWith(".env.") ||
      lower.endsWith(".patch")
    ) {
      fail(`forbidden release artifact in npm tarball: ${path}`);
    }
  }

  if (packEntry.version !== expectedVersion) {
    fail(`packed version must be ${expectedVersion}, got ${packEntry.version}`);
  }
}

function writeConsumerFixture(consumerRoot) {
  writeFileSync(
    join(consumerRoot, "smoke.html"),
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>LFE Lite D5 Consumer Smoke</title></head>
<body>D5 consumer smoke</body>
</html>
`,
  );
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

async function startStaticServer(root) {
  const rootPrefix = resolve(root) + sep;

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = resolve(root, normalize(relative));

      if (!(filePath + sep).startsWith(rootPrefix) && filePath !== resolve(root)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404);
        response.end("Not Found");
        return;
      }

      response.writeHead(200, { "Content-Type": contentType(filePath) });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    fail("unable to determine consumer smoke server port");
  }

  return { server, port: address.port };
}

async function consumerSmoke(tarball, tempRoot) {
  const consumer = join(tempRoot, "consumer");
  mkdirSync(consumer, { recursive: true });

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "lfe-lite-d5-consumer",
        private: true,
        type: "module",
      },
      null,
      2,
    ) + "\n",
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: consumer },
  );

  run(
    "node",
    [
      "--input-type=module",
      "--eval",
      `const m = await import("@planeslogic/lfe-lite");
if (m.LFE_LITE_SDK_VERSION !== "${expectedVersion}") {
  throw new Error("SDK version projection mismatch");
}
if (typeof m.LfeLite?.create !== "function") {
  throw new Error("LfeLite.create missing from root export");
}`,
    ],
    { cwd: consumer },
  );

  run(
    "node",
    [
      "--input-type=module",
      "--eval",
      `let rejected = false;
try {
  await import("@planeslogic/lfe-lite/worker");
} catch (error) {
  rejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}
if (!rejected) {
  throw new Error("internal worker subpath must not be exported");
}`,
    ],
    { cwd: consumer },
  );

  run(
    "node",
    [
      "--input-type=module",
      "--eval",
      `let rejected = false;
try {
  await import("@planeslogic/lfe-lite/internal/core-version");
} catch (error) {
  rejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}
if (!rejected) {
  throw new Error("internal Core subpath must not be exported");
}`,
    ],
    { cwd: consumer },
  );

  writeConsumerFixture(consumer);

  const { server, port } = await startStaticServer(consumer);
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/smoke.html`);

    const result = await page.evaluate(async (version) => {
      const sdk = await import(
        "/node_modules/@planeslogic/lfe-lite/dist/index.js"
      );

      if (sdk.LFE_LITE_SDK_VERSION !== version) {
        throw new Error("browser SDK version mismatch");
      }

      const lfe = await sdk.LfeLite.create();
      const state = await lfe.licenseState();

      const badgeMounted = Boolean(
        document.querySelector("[data-planeslogic-lfe-lite-branding]"),
      );

      await lfe.define({ keyId: 0, name: "active", type: "bool" });
      await lfe.add(1n, { active: true });

      const set = await lfe.resolve({
        op: "eq",
        key: "active",
        value: true,
      });

      const size = await set.size();
      const first = (await set.first(10)).map(String);

      await set.release();
      await lfe.close();

      const badgeAfterClose = Boolean(
        document.querySelector("[data-planeslogic-lfe-lite-branding]"),
      );

      return {
        status: state.status,
        writeEnabled: state.write_enabled,
        resolveEnabled: state.resolve_enabled,
        brandingRequired: state.branding_required,
        badgeMounted,
        size,
        first,
        badgeAfterClose,
      };
    }, expectedVersion);

    if (result.status !== "DEVELOPMENT") {
      fail(`consumer Core status expected DEVELOPMENT, got ${result.status}`);
    }
    if (!result.writeEnabled || !result.resolveEnabled || !result.brandingRequired) {
      fail("consumer Development capability matrix mismatch");
    }
    if (!result.badgeMounted || result.badgeAfterClose) {
      fail("consumer branding lifecycle mismatch");
    }
    if (result.size !== 1 || result.first.join(",") !== "1") {
      fail("consumer mutation/resolve smoke mismatch");
    }
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function main() {
  checkPackageMetadata();
  checkToolVersions();

  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "build"]);
  assertNoStandaloneWasm();
  run("npm", ["test"]);
  run("npm", ["run", "test:browser"]);

  const tempRoot = mkdtempSync(join(tmpdir(), "lfe-lite-d5-"));
  const packDir = join(tempRoot, "pack");
  mkdirSync(packDir, { recursive: true });

  try {
    const packJson = run(
      "npm",
      ["pack", "--json", "--pack-destination", packDir],
      { capture: true },
    );

    const packed = JSON.parse(packJson);
    if (!Array.isArray(packed) || packed.length !== 1) {
      fail("npm pack did not return exactly one package");
    }

    inspectPackedFiles(packed[0]);

    const tarball = join(packDir, packed[0].filename);
    if (!existsSync(tarball)) {
      fail(`npm tarball not found: ${tarball}`);
    }

    await consumerSmoke(tarball, tempRoot);

    console.log("");
    console.log("D5 PASSED");
    console.log(`Validated ${packed[0].name}@${packed[0].version}`);
    console.log("Tarball boundary, export encapsulation, embedded Worker/Core, and fresh consumer smoke validated.");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(join(repoRoot, "test-results"), { recursive: true, force: true });
  }
}

main().catch((error) => {
  rmSync(join(repoRoot, "test-results"), { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
