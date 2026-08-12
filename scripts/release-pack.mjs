import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "release");

mkdirSync(outDir, { recursive: true });

execFileSync(
  "npm",
  ["pack", "--pack-destination", outDir],
  { cwd: repoRoot, stdio: "inherit" },
);
