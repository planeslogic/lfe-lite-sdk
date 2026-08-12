import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    worker: "src/worker.ts",
  },
  format: ["esm"],
  target: "es2022",
  clean: true,
  dts: false,
  splitting: false,
  outDir: "dist",
});
