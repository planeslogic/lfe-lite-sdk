import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const defaultCoreRepo = resolve(repoRoot, "../../rust-wasm-sdk-v1");
const coreRepo = resolve(process.env.LFE_LITE_CORE_REPO || defaultCoreRepo);

const expectedVersion = "v0.1.4";
const expectedCommit = "d9a97cb";

function capture(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

const actualCommit = capture("git", ["rev-parse", "--short=7", "HEAD"], coreRepo);
if (actualCommit !== expectedCommit) {
  throw new Error(
    `Core commit mismatch: expected ${expectedCommit}, got ${actualCommit}. ` +
      `Checkout ${expectedVersion} before embedding.`,
  );
}

const actualTag = capture(
  "git",
  ["describe", "--tags", "--exact-match", "HEAD"],
  coreRepo,
);
if (actualTag !== expectedVersion) {
  throw new Error(`Core tag mismatch: expected ${expectedVersion}, got ${actualTag}`);
}

const temp = mkdtempSync(join(tmpdir(), "lfe-lite-core-"));
const wasmOut = join(temp, "pkg");

try {
  execFileSync(
    "wasm-pack",
    ["build", coreRepo, "--target", "web", "--release", "--out-dir", wasmOut],
    { cwd: repoRoot, stdio: "inherit" },
  );

  const pkg = JSON.parse(readFileSync(join(wasmOut, "package.json"), "utf8"));
  const jsName = pkg.module || pkg.main;
  if (!jsName) {
    throw new Error("wasm-pack package.json does not declare a JS module");
  }

  const stem = basename(jsName, ".js");
  const wasmName = `${stem}_bg.wasm`;
  const dtsName = `${stem}.d.ts`;

  const wasm = readFileSync(join(wasmOut, wasmName));
  const generated = join(repoRoot, "src/internal/generated");
  mkdirSync(generated, { recursive: true });

  copyFileSync(join(wasmOut, jsName), join(generated, "core-bindings.js"));
  copyFileSync(join(wasmOut, dtsName), join(generated, "core-bindings.d.ts"));

  const source = `// GENERATED FILE. DO NOT EDIT.
// Source: LFE Lite Core ${expectedVersion} / ${expectedCommit}

export const EMBEDDED_CORE_VERSION = ${JSON.stringify(expectedVersion)};
export const EMBEDDED_CORE_COMMIT = ${JSON.stringify(expectedCommit)};
export const EMBEDDED_CORE_WASM_BASE64 = ${JSON.stringify(wasm.toString("base64"))};

export function embeddedCoreWasmBytes(): Uint8Array {
  const binary = atob(EMBEDDED_CORE_WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
`;

  writeFileSync(join(generated, "core-wasm.ts"), source);

  console.log(`Embedded LFE Lite Core ${expectedVersion} (${expectedCommit})`);
  console.log(`WASM bytes: ${wasm.byteLength}`);
  console.log("Generated: src/internal/generated/");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
