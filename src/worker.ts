import initCore, {
  LfeLiteLicensedCompactStore,
  LfeLiteLicensedStore,
  SeqSetHandle,
} from "./internal/generated/core-bindings.js";
import { embeddedCoreWasmBytes } from "./internal/generated/core-wasm.js";
import {
  WORKER_PROTOCOL_VERSION,
  type BootstrapPayload,
  type WorkerFailure,
  type WorkerRequest,
  type WorkerSuccess,
} from "./internal/protocol.js";
import type { LfeBatch, LogicalDefinition, LogicalRecord, Query } from "./types.js";

type CoreStore = LfeLiteLicensedCompactStore | LfeLiteLicensedStore;

let store: CoreStore | null = null;
let nextSeqSetHandleId = 1;
const seqSets = new Map<number, SeqSetHandle>();

function success(requestId: number, value?: unknown): WorkerSuccess {
  return {
    protocol: WORKER_PROTOCOL_VERSION,
    requestId,
    ok: true,
    value,
  };
}

function failure(requestId: number, code: string, message: string): WorkerFailure {
  return {
    protocol: WORKER_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: { code, message },
  };
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const identity = /^([A-Za-z][A-Za-z0-9_]*)\b(?::|\(|\s|$)/.exec(message)?.[1];

  return {
    code: identity || (error instanceof Error ? error.name : "CORE_ERROR") || "CORE_ERROR",
    message,
  };
}

async function bootstrap(payload: BootstrapPayload): Promise<unknown> {
  if (store !== null) {
    throw new Error("Worker is already bootstrapped");
  }

  await initCore(embeddedCoreWasmBytes());

  const license = payload.license ?? undefined;
  store =
    payload.engine === "standard"
      ? new LfeLiteLicensedStore(
          payload.runtimeHostname,
          license,
          payload.nowUnixMs,
        )
      : new LfeLiteLicensedCompactStore(
          payload.runtimeHostname,
          license,
          payload.nowUnixMs,
        );

  return store.license_state();
}

function requireStore(): CoreStore {
  if (store === null) {
    throw new Error("CORE_INIT_FAILED: Core is not bootstrapped");
  }
  return store;
}

function requireSeqSet(handleId: number): SeqSetHandle {
  const handle = seqSets.get(handleId);
  if (!handle) {
    throw new Error(`SEQSET_NOT_FOUND: ${handleId}`);
  }
  return handle;
}

function registerSeqSet(handle: SeqSetHandle): number {
  const handleId = nextSeqSetHandleId;
  nextSeqSetHandleId += 1;
  seqSets.set(handleId, handle);
  return handleId;
}

function releaseSeqSet(handleId: number): void {
  const handle = seqSets.get(handleId);
  if (!handle) {
    return;
  }
  seqSets.delete(handleId);
  handle.free();
}

function releaseAllSeqSets(): void {
  for (const handle of seqSets.values()) {
    handle.free();
  }
  seqSets.clear();
}

function closeStore(): void {
  releaseAllSeqSets();
  if (store !== null) {
    store.free();
    store = null;
  }
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.protocol !== WORKER_PROTOCOL_VERSION) {
    self.postMessage(
      failure(
        request.requestId,
        "WORKER_PROTOCOL_ERROR",
        "Unsupported Worker protocol",
      ),
    );
    return;
  }

  try {
    let value: unknown;

    switch (request.op) {
      case "bootstrap":
        value = await bootstrap(request.payload as BootstrapPayload);
        break;

      case "license_state":
        value = requireStore().license_state();
        break;

      case "set_license": {
        const payload = request.payload as {
          license: string | null;
          nowUnixMs: number;
        };
        value = requireStore().set_license(
          payload.license ?? undefined,
          payload.nowUnixMs,
        );
        break;
      }

      case "refresh_license": {
        const payload = request.payload as { nowUnixMs: number };
        value = requireStore().refresh_license(payload.nowUnixMs);
        break;
      }

      case "define": {
        const definition = request.payload as LogicalDefinition;
        requireStore().define(
          definition.keyId,
          definition.name,
          definition.type,
        );
        value = undefined;
        break;
      }

      case "add": {
        const payload = request.payload as {
          seq: bigint;
          logical: LogicalRecord;
        };
        requireStore().add(payload.seq, payload.logical);
        value = undefined;
        break;
      }

      case "add_batch": {
        const batch = request.payload as LfeBatch;
        value = requireStore().add_batch(batch.seqs, batch.columns);
        break;
      }

      case "update": {
        const payload = request.payload as {
          seq: bigint;
          patch: LogicalRecord;
        };
        requireStore().update(payload.seq, payload.patch);
        value = undefined;
        break;
      }

      case "delete": {
        const payload = request.payload as { seq: bigint };
        requireStore().delete(payload.seq);
        value = undefined;
        break;
      }

      case "resolve": {
        const payload = request.payload as { query: Query };
        const handle = requireStore().resolve(payload.query);
        value = { handleId: registerSeqSet(handle) };
        break;
      }

      case "resolve_bounded": {
        const payload = request.payload as {
          query: Query;
          startSeq: bigint;
          endSeq: bigint;
        };
        const handle = requireStore().resolve_bounded(
          payload.query,
          payload.startSeq,
          payload.endSeq,
        );
        value = { handleId: registerSeqSet(handle) };
        break;
      }

      case "projection_valid_from_seq":
        value = requireStore().projection_valid_from_seq();
        break;

      case "purge_before": {
        const payload = request.payload as { seqExclusive: bigint };
        value = requireStore().purge_before(payload.seqExclusive);
        break;
      }

      case "begin_reconstruction": {
        const payload = request.payload as { startSeq: bigint };
        requireStore().begin_reconstruction(payload.startSeq);
        value = undefined;
        break;
      }

      case "reconstruction_add_batch": {
        const batch = request.payload as LfeBatch;
        value = requireStore().reconstruction_add_batch(batch.seqs, batch.columns);
        break;
      }

      case "reconstruction_state":
        value = requireStore().reconstruction_state();
        break;

      case "publish_reconstruction":
        value = requireStore().publish_reconstruction();
        break;

      case "abort_reconstruction":
        value = requireStore().abort_reconstruction();
        break;

      case "seqset_size": {
        const payload = request.payload as { handleId: number };
        value = requireSeqSet(payload.handleId).size();
        break;
      }

      case "seqset_is_empty": {
        const payload = request.payload as { handleId: number };
        value = requireSeqSet(payload.handleId).is_empty();
        break;
      }

      case "seqset_has": {
        const payload = request.payload as { handleId: number; seq: bigint };
        value = requireSeqSet(payload.handleId).has(payload.seq);
        break;
      }

      case "seqset_first": {
        const payload = request.payload as { handleId: number; limit: number };
        const seqs = requireSeqSet(payload.handleId).first(payload.limit);
        value = Array.from(seqs);
        break;
      }

      case "seqset_release": {
        const payload = request.payload as { handleId: number };
        releaseSeqSet(payload.handleId);
        value = undefined;
        break;
      }

      case "close":
        closeStore();
        value = undefined;
        break;

      default:
        self.postMessage(
          failure(
            request.requestId,
            "WORKER_PROTOCOL_ERROR",
            "Unknown Worker operation",
          ),
        );
        return;
    }

    self.postMessage(success(request.requestId, value));
  } catch (error) {
    const normalized = normalizeError(error);
    self.postMessage(
      failure(request.requestId, normalized.code, normalized.message),
    );
  }
});
