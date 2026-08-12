#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PRIVATE_KEY="${LFE_LITE_PRODUCTION_PRIVATE_KEY:-}"
EXPECTED_PUBLIC_SHA256="fd4091e2ecdb479f0cc3df4afaeb47212a3952c988349041f81a5902e8234140"

fail() {
  echo "D4 signed browser validation failed: $*" >&2
  exit 1
}

for tool in openssl python3 npx; do
  command -v "$tool" >/dev/null || fail "$tool not found"
done

[[ -n "$PRIVATE_KEY" ]] || fail "set LFE_LITE_PRODUCTION_PRIVATE_KEY to the external Ed25519 private key"
[[ -f "$PRIVATE_KEY" ]] || fail "private key not found: $PRIVATE_KEY"

ACTUAL_PUBLIC_SHA256="$({
  openssl pkey -in "$PRIVATE_KEY" -pubout -outform DER 2>/dev/null \
    | tail -c 32 \
    | sha256sum \
    | awk '{print $1}'
})"
[[ "$ACTUAL_PUBLIC_SHA256" == "$EXPECTED_PUBLIC_SHA256" ]] \
  || fail "production trust-root fingerprint mismatch"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

python3 - "$TMP_DIR" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

out = pathlib.Path(sys.argv[1])
issued = datetime.now(timezone.utc).replace(microsecond=0)
expires = issued + timedelta(seconds=6)
fmt = lambda value: value.strftime("%Y-%m-%dT%H:%M:%SZ")

doc = {
    "version": 1,
    "product": "lfe-lite",
    "alg": "Ed25519",
    "key_id": "planeslogic-lfe-lite-2026-01",
    "license_id": "lic_d4_browser_validation",
    "license_type": "single_domain",
    "domain": "app.customer.com",
    "issued_at": fmt(issued),
    "expires_at": fmt(expires),
    "entitlements": {"write": True, "remove_branding": True},
}

payload = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
(out / "payload.json").write_text(payload, encoding="utf-8")
(out / "unsigned.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
PY

openssl pkeyutl \
  -sign \
  -rawin \
  -inkey "$PRIVATE_KEY" \
  -in "$TMP_DIR/payload.json" \
  -out "$TMP_DIR/signature.bin"

python3 - "$TMP_DIR" <<'PY'
import base64
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
doc = json.loads((root / "unsigned.json").read_text(encoding="utf-8"))
doc["signature"] = base64.urlsafe_b64encode(
    (root / "signature.bin").read_bytes()
).decode("ascii").rstrip("=")
(root / "license.json").write_text(
    json.dumps(doc, separators=(",", ":")),
    encoding="utf-8",
)
PY

LFE_D4_PRODUCTION_LICENSE_JSON="$(cat "$TMP_DIR/license.json")" \
  npx playwright test tests/browser/d4-license-lifecycle.spec.mjs
