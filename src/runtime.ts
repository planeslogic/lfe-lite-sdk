import {
  WORKER_PROTOCOL_VERSION,
  type BootstrapPayload,
  type WorkerOperation,
  type WorkerRequest,
  type WorkerResponse,
} from "./internal/protocol.js";
import {
  removeBrandingContribution,
  setBrandingContribution,
} from "./branding.js";
import { LfeLiteError } from "./errors.js";
import {
  nextExpiryDelayMs,
  parseExpiryMs,
} from "./internal/license-lifecycle.js";
import { LfeSeqSet } from "./seqset.js";
import type {
  LfeBatch,
  LfeLiteLicenseState,
  LfeLiteOptions,
  LogicalDefinition,
  LogicalRecord,
  Query,
  ReconstructionState,
  ResolveSeqBoundary,
} from "./types.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  operation: string;
}

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U32 = 0xffff_ffff;
const SUPPORTED_TYPES = new Set(["bool", "uint32", "float64"]);

export class LfeLite {
  #worker: Worker;
  #closed = false;
  #closing = false;
  #nextRequestId = 1;
  #pending = new Map<number, PendingRequest>();
  #licenseState: LfeLiteLicenseState | null = null;
  #expiresAtMs: number | null = null;
  #evaluatedExpiryMs: number | null = null;
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshInFlight: Promise<LfeLiteLicenseState> | null = null;
  #brandingToken = {};
  #lifecycleListenersInstalled = false;

  #onFocus = (): void => {
    this.#handleResume();
  };

  #onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      this.#handleResume();
    }
  };

  private constructor(worker: Worker) {
    this.#worker = worker;

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      this.#handleResponse(event.data);
    });

    worker.addEventListener("error", () => {
      this.#terminateUnexpectedly();
    });

    worker.addEventListener("messageerror", () => {
      this.#terminateUnexpectedly();
    });
  }

  static async create(options: LfeLiteOptions = {}): Promise<LfeLite> {
    if (
      typeof window === "undefined" ||
      typeof Worker === "undefined" ||
      typeof WebAssembly === "undefined"
    ) {
      throw new LfeLiteError(
        "SDK_NOT_SUPPORTED",
        "LFE Lite requires a modern browser with Worker and WebAssembly support",
        "create",
      );
    }

    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
      name: "lfe-lite",
    });

    const runtime = new LfeLite(worker);

    const payload: BootstrapPayload = {
      engine: options.engine ?? "compact",
      runtimeHostname: window.location.hostname,
      license: options.license ?? null,
      nowUnixMs: Date.now(),
    };

    try {
      const state = (await runtime.#request(
        "bootstrap",
        payload,
      )) as LfeLiteLicenseState;
      runtime.#installLifecycleListeners();
      runtime.#applyLicenseState(state, payload.nowUnixMs);
      return runtime;
    } catch (error) {
      runtime.#cleanupLifecycle();
      worker.terminate();
      runtime.#closed = true;
      throw error;
    }
  }

  async licenseState(): Promise<LfeLiteLicenseState> {
    if (this.#closed || this.#closing) {
      throw new LfeLiteError(
        "SDK_CLOSED",
        "LFE Lite runtime is closed",
        "licenseState",
      );
    }

    if (this.#licenseState === null) {
      const state = (await this.#request(
        "license_state",
      )) as LfeLiteLicenseState;
      this.#applyLicenseState(state, Number.NEGATIVE_INFINITY);
    }

    return { ...this.#licenseState! };
  }

  async setLicense(license: string | null): Promise<LfeLiteLicenseState> {
    if (license !== null && typeof license !== "string") {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "license must be a JSON string or null",
        "setLicense",
      );
    }

    const nowUnixMs = Date.now();
    const state = (await this.#request("set_license", {
      license,
      nowUnixMs,
    })) as LfeLiteLicenseState;
    this.#applyLicenseState(state, nowUnixMs);
    return { ...state };
  }

  async define(definition: LogicalDefinition): Promise<void> {
    assertDefinition(definition);
    await this.#request("define", definition);
  }

  async add(seq: bigint, logical: LogicalRecord): Promise<void> {
    assertSeq(seq, "add");
    assertLogicalRecord(logical, "add");
    await this.#request("add", { seq, logical });
  }

  async addBatch(batch: LfeBatch): Promise<number> {
    assertBatch(batch);
    return (await this.#request("add_batch", batch)) as number;
  }

  async update(seq: bigint, patch: LogicalRecord): Promise<void> {
    assertSeq(seq, "update");
    assertLogicalRecord(patch, "update");
    await this.#request("update", { seq, patch });
  }

  async delete(seq: bigint): Promise<void> {
    assertSeq(seq, "delete");
    await this.#request("delete", { seq });
  }

  async resolve(query: Query): Promise<LfeSeqSet> {
    assertQueryObject(query);
    const response = (await this.#request("resolve", { query })) as {
      handleId?: unknown;
    };

    if (!Number.isSafeInteger(response?.handleId) || (response.handleId as number) <= 0) {
      throw new LfeLiteError(
        "WORKER_PROTOCOL_ERROR",
        "Worker returned an invalid SeqSet handle",
        "resolve",
      );
    }

    return new LfeSeqSet(
      {
        request: (op, payload) => this.#request(op, payload),
        isClosed: () => this.#closed || this.#closing,
      },
      response.handleId as number,
    );
  }

  async resolveBounded(
    query: Query,
    boundary: ResolveSeqBoundary,
  ): Promise<LfeSeqSet> {
    assertQueryObject(query, "resolveBounded");
    assertResolveBoundary(boundary);
    const response = (await this.#request("resolve_bounded", {
      query,
      startSeq: boundary.startSeq,
      endSeq: boundary.endSeq,
    })) as { handleId?: unknown };

    if (!Number.isSafeInteger(response?.handleId) || (response.handleId as number) <= 0) {
      throw new LfeLiteError(
        "WORKER_PROTOCOL_ERROR",
        "Worker returned an invalid SeqSet handle",
        "resolveBounded",
      );
    }

    return new LfeSeqSet(
      {
        request: (op, payload) => this.#request(op, payload),
        isClosed: () => this.#closed || this.#closing,
      },
      response.handleId as number,
    );
  }

  async projectionValidFromSeq(): Promise<bigint> {
    return (await this.#request("projection_valid_from_seq")) as bigint;
  }

  async purgeBefore(seqExclusive: bigint): Promise<bigint> {
    assertSeq(seqExclusive, "purgeBefore");
    return (await this.#request("purge_before", { seqExclusive })) as bigint;
  }

  async beginReconstruction(startSeq: bigint): Promise<void> {
    assertSeq(startSeq, "beginReconstruction");
    await this.#request("begin_reconstruction", { startSeq });
  }

  async reconstructionAddBatch(batch: LfeBatch): Promise<number> {
    assertBatch(batch, "reconstructionAddBatch");
    return (await this.#request("reconstruction_add_batch", batch)) as number;
  }

  async reconstructionState(): Promise<ReconstructionState | null> {
    const state = (await this.#request("reconstruction_state")) as
      | { start_seq: bigint; end_seq_exclusive: bigint; staged_records: number }
      | null;

    if (state === null) {
      return null;
    }

    return {
      startSeq: state.start_seq,
      endSeqExclusive: state.end_seq_exclusive,
      stagedRecords: state.staged_records,
    };
  }

  async publishReconstruction(): Promise<bigint> {
    return (await this.#request("publish_reconstruction")) as bigint;
  }

  async abortReconstruction(): Promise<boolean> {
    return (await this.#request("abort_reconstruction")) as boolean;
  }

  async close(): Promise<void> {
    if (this.#closed || this.#closing) {
      return;
    }

    this.#closing = true;
    this.#cleanupLifecycle();
    try {
      await this.#request("close", undefined, true);
    } finally {
      this.#closed = true;
      this.#closing = false;
      this.#worker.terminate();
      this.#rejectAll(
        new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", "close"),
      );
    }
  }

  #installLifecycleListeners(): void {
    if (this.#lifecycleListenersInstalled) {
      return;
    }

    window.addEventListener("focus", this.#onFocus);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    this.#lifecycleListenersInstalled = true;
  }

  #applyLicenseState(
    state: LfeLiteLicenseState,
    evaluatedAtMs: number,
  ): void {
    if (this.#closed || this.#closing) {
      return;
    }

    this.#licenseState = { ...state };
    this.#expiresAtMs = parseExpiryMs(state.expires_at);
    this.#evaluatedExpiryMs =
      this.#expiresAtMs !== null && this.#expiresAtMs <= evaluatedAtMs
        ? this.#expiresAtMs
        : null;
    this.#scheduleExpiryRefresh();
    setBrandingContribution(this.#brandingToken, state.branding_required);
  }

  #scheduleExpiryRefresh(): void {
    this.#clearExpiryTimer();

    if (
      this.#closed ||
      this.#closing ||
      this.#expiresAtMs === null ||
      this.#evaluatedExpiryMs === this.#expiresAtMs
    ) {
      return;
    }

    const delay = nextExpiryDelayMs(this.#expiresAtMs, Date.now());
    this.#expiryTimer = setTimeout(() => {
      this.#expiryTimer = null;

      if (this.#closed || this.#closing || this.#expiresAtMs === null) {
        return;
      }

      if (nextExpiryDelayMs(this.#expiresAtMs, Date.now()) > 0) {
        this.#scheduleExpiryRefresh();
        return;
      }

      void this.#refreshLicenseState().catch(() => undefined);
    }, delay);
  }

  #clearExpiryTimer(): void {
    if (this.#expiryTimer !== null) {
      clearTimeout(this.#expiryTimer);
      this.#expiryTimer = null;
    }
  }

  #handleResume(): void {
    if (this.#closed || this.#closing || this.#expiresAtMs === null) {
      return;
    }

    if (Date.now() >= this.#expiresAtMs) {
      if (this.#evaluatedExpiryMs === this.#expiresAtMs) {
        return;
      }
      void this.#refreshLicenseState().catch(() => undefined);
      return;
    }

    this.#scheduleExpiryRefresh();
  }

  #refreshLicenseState(): Promise<LfeLiteLicenseState> {
    if (this.#refreshInFlight !== null) {
      return this.#refreshInFlight;
    }

    const nowUnixMs = Date.now();
    const refresh = this.#request("refresh_license", {
      nowUnixMs,
    }).then((value) => {
      const state = value as LfeLiteLicenseState;
      this.#applyLicenseState(state, nowUnixMs);
      return { ...state };
    });

    this.#refreshInFlight = refresh.then(
      (state) => {
        this.#refreshInFlight = null;
        return state;
      },
      (error) => {
        this.#refreshInFlight = null;
        throw error;
      },
    );

    return this.#refreshInFlight;
  }

  #cleanupLifecycle(): void {
    this.#clearExpiryTimer();
    this.#expiresAtMs = null;
    this.#evaluatedExpiryMs = null;

    if (this.#lifecycleListenersInstalled) {
      window.removeEventListener("focus", this.#onFocus);
      document.removeEventListener("visibilitychange", this.#onVisibilityChange);
      this.#lifecycleListenersInstalled = false;
    }

    removeBrandingContribution(this.#brandingToken);
  }

  #request(
    op: WorkerOperation,
    payload?: unknown,
    allowDuringClose = false,
  ): Promise<unknown> {
    if (this.#closed || (this.#closing && !allowDuringClose)) {
      return Promise.reject(
        new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", op),
      );
    }

    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;

    const request: WorkerRequest = {
      protocol: WORKER_PROTOCOL_VERSION,
      requestId,
      op,
      payload,
    };

    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject, operation: op });

      try {
        this.#worker.postMessage(request);
      } catch (error) {
        this.#pending.delete(requestId);
        reject(
          new LfeLiteError(
            "WORKER_PROTOCOL_ERROR",
            error instanceof Error ? error.message : String(error),
            op,
          ),
        );
      }
    });
  }

  #handleResponse(response: WorkerResponse): void {
    if (response.protocol !== WORKER_PROTOCOL_VERSION) {
      this.#terminateUnexpectedly();
      return;
    }

    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      return;
    }

    this.#pending.delete(response.requestId);

    if (response.ok) {
      pending.resolve(response.value);
      return;
    }

    pending.reject(
      new LfeLiteError(
        response.error.code,
        response.error.message,
        pending.operation,
      ),
    );
  }

  #terminateUnexpectedly(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#closing = false;
    this.#cleanupLifecycle();
    this.#worker.terminate();
    this.#rejectAll(
      new LfeLiteError(
        "WORKER_TERMINATED",
        "LFE Lite Worker terminated unexpectedly",
      ),
    );
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function assertSeq(seq: bigint, operation: string): void {
  if (typeof seq !== "bigint" || seq < 0n || seq > MAX_U64) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "seq must be a bigint in the uint64 range",
      operation,
    );
  }
}

function assertResolveBoundary(boundary: ResolveSeqBoundary): void {
  if (!boundary || typeof boundary !== "object") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "boundary must be an object",
      "resolveBounded",
    );
  }
  assertSeq(boundary.startSeq, "resolveBounded");
  assertSeq(boundary.endSeq, "resolveBounded");
  if (boundary.startSeq > boundary.endSeq) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "boundary.startSeq must be less than or equal to boundary.endSeq",
      "resolveBounded",
    );
  }
}

function assertDefinition(definition: LogicalDefinition): void {
  if (!definition || typeof definition !== "object") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition must be an object",
      "define",
    );
  }
  if (
    !Number.isInteger(definition.keyId) ||
    definition.keyId < 0 ||
    definition.keyId > MAX_U32
  ) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition.keyId must be uint32",
      "define",
    );
  }
  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition.name must be a non-empty string",
      "define",
    );
  }
  if (!SUPPORTED_TYPES.has(definition.type)) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition.type is unsupported",
      "define",
    );
  }
}

function assertLogicalRecord(value: LogicalRecord, operation: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "logical record must be an object",
      operation,
    );
  }
}

function assertBatch(batch: LfeBatch, operation = "addBatch"): void {
  if (!batch || typeof batch !== "object") {
    throw new LfeLiteError("INVALID_ARGUMENT", "batch must be an object", operation);
  }
  if (!(batch.seqs instanceof BigUint64Array)) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "batch.seqs must be BigUint64Array",
      operation,
    );
  }
  if (!Array.isArray(batch.columns) || batch.columns.length === 0) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "batch.columns must be a non-empty array",
      operation,
    );
  }

  for (const column of batch.columns) {
    if (!column || typeof column !== "object") {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column must be an object",
        operation,
      );
    }
    if (!Number.isInteger(column.keyId) || column.keyId < 0 || column.keyId > MAX_U32) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column keyId must be uint32",
        operation,
      );
    }
    if (!SUPPORTED_TYPES.has(column.type)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column type is unsupported",
        operation,
      );
    }
    if (column.values.length !== batch.seqs.length) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column length must match batch.seqs length",
        operation,
      );
    }
    if (column.type === "bool" && !(column.values instanceof Uint8Array)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "bool batch column requires Uint8Array",
        operation,
      );
    }
    if (column.type === "uint32" && !(column.values instanceof Uint32Array)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "uint32 batch column requires Uint32Array",
        operation,
      );
    }
    if (column.type === "float64" && !(column.values instanceof Float64Array)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "float64 batch column requires Float64Array",
        operation,
      );
    }
  }
}

function assertQueryObject(query: Query, operation = "resolve"): void {
  if (!query || typeof query !== "object" || typeof query.op !== "string") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "query must be a query object",
      operation,
    );
  }
}
