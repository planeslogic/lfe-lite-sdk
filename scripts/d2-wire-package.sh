#!/usr/bin/env bash
set -euo pipefail

npm pkg set \
  scripts.core:embed="node scripts/embed-core.mjs" \
  scripts.build:js="tsup" \
  scripts.build:types="tsc -p tsconfig.build.json" \
  scripts.build="npm run core:embed && npm run build:js && npm run build:types" \
  scripts.test="vitest run" \
  scripts.test:browser="playwright test tests/browser/d2-bootstrap.spec.mjs"

npm install -D @playwright/test

if ! grep -qxF "src/internal/generated/" .gitignore; then
  printf "\n# Generated embedded Core artifacts\nsrc/internal/generated/\n" >> .gitignore
fi

echo "D2 package wiring updated."
