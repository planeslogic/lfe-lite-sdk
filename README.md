# @planeslogic/lfe-lite

Official browser Distribution SDK for **LFE Lite** by PlanesLogic.

LFE Lite runs its Rust/WASM Core inside a dedicated Web Worker. The public application surface is the JavaScript/TypeScript SDK; applications do not receive the raw Core instance.

## Release

```text
SDK:  0.1.0-rc.1
Core: v0.1.4 / d9a97cb
```

This release candidate is browser-only.

## Requirements

The runtime requires a modern browser with:

- ES modules
- Web Worker
- WebAssembly
- BigInt
- typed arrays
- DOM APIs

Node.js is used for SDK build and release tooling only. Node/SSR runtime support is not part of this release.

## Install

```bash
npm install @planeslogic/lfe-lite@next
```

## Create a runtime

```ts
import { LfeLite } from "@planeslogic/lfe-lite";

const lfe = await LfeLite.create();
const state = await lfe.licenseState();

console.log(state);
```

The default engine is `compact`.

## Define, add, and resolve

```ts
await lfe.define({
  keyId: 0,
  name: "status",
  type: "uint32",
});

await lfe.define({
  keyId: 1,
  name: "active",
  type: "bool",
});

await lfe.add(1n, {
  status: 2,
  active: true,
});

const result = await lfe.resolve({
  op: "and",
  args: [
    { op: "eq", key: "status", value: 2 },
    { op: "eq", key: "active", value: true },
  ],
});

console.log(await result.size());
console.log(await result.first(10));

await result.release();
```

Public sequence identifiers use `bigint`.

## Batch add

The release-candidate batch API uses typed columns:

```ts
await lfe.addBatch({
  seqs: new BigUint64Array([10n, 20n]),
  columns: [
    {
      keyId: 0,
      type: "uint32",
      values: new Uint32Array([1, 2]),
    },
    {
      keyId: 1,
      type: "bool",
      values: new Uint8Array([1, 0]),
    },
  ],
});
```

One public batch maps to one Core batch operation.

## License behavior

The Rust/WASM Core is the authorization authority.

On built-in Development hosts such as `localhost` and `127.0.0.1`:

```text
write       enabled
resolve     enabled
branding    required
```

On a production hostname without a valid commercial license:

```text
write       disabled
resolve     enabled
branding    required
```

A valid commercial license may enable writes and remove required branding according to the Core-returned license state.

The Distribution SDK does not perform JavaScript-only signature authorization and contains no production signing private key.

## Branding

When the Core returns:

```text
branding_required = true
```

the SDK mounts the official attribution badge:

```text
Powered by PlanesLogic · LFE Lite
```

Branding is reconciled across license refreshes and multiple runtimes in the same document.

## Close

Release SeqSets when they are no longer needed and close the runtime when the application is finished:

```ts
await result.release();
await lfe.close();
```

`close()` terminates the Worker and cleans SDK-owned lifecycle resources.

## Distribution boundary

The supported package API is only:

```text
@planeslogic/lfe-lite
```

Internal Worker and implementation subpaths are not public APIs.

The npm package ships the Worker bundle with the Core embedded in JavaScript representation. It does not ship a standalone `.wasm` asset.

## Release-candidate legal status

This technical release candidate uses package metadata:

```text
UNLICENSED
```

This release candidate is distributed under `UNLICENSED` package metadata and is not an open-source grant. The public OSS repository and final source license remain separate release decisions.
