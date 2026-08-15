// src/internal/protocol.ts
var WORKER_PROTOCOL_VERSION = 1;

// src/branding.ts
var BADGE_TEXT = "Powered by PlanesLogic \xB7 LFE Lite";
var BADGE_ATTRIBUTE = "data-planeslogic-lfe-lite-branding";
var documentStates = /* @__PURE__ */ new WeakMap();
function getState(documentRef) {
  let state = documentStates.get(documentRef);
  if (!state) {
    state = {
      requiredBy: /* @__PURE__ */ new Set(),
      host: null,
      shadow: null,
      observer: null,
      reconcileQueued: false
    };
    documentStates.set(documentRef, state);
  }
  return state;
}
function mountTarget(documentRef) {
  return documentRef.body ?? documentRef.documentElement;
}
function createBadge(documentRef, state) {
  const target = mountTarget(documentRef);
  if (!target) {
    return;
  }
  const host = documentRef.createElement("div");
  host.setAttribute(BADGE_ATTRIBUTE, "");
  host.setAttribute("aria-label", BADGE_TEXT);
  const shadow = host.attachShadow({ mode: "closed" });
  const style = documentRef.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }
    .badge {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483647;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      max-width: calc(100vw - 24px);
      padding: 6px 9px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      background: rgba(12, 18, 14, 0.94);
      color: #d7ffe4;
      font: 500 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 0.01em;
      white-space: nowrap;
      pointer-events: none;
    }
  `;
  const badge = documentRef.createElement("span");
  badge.className = "badge";
  badge.textContent = BADGE_TEXT;
  shadow.append(style, badge);
  target.appendChild(host);
  state.host = host;
  state.shadow = shadow;
}
function ensureObserver(documentRef, state) {
  if (state.observer || typeof MutationObserver === "undefined") {
    return;
  }
  state.observer = new MutationObserver(() => {
    if (state.requiredBy.size === 0 || state.reconcileQueued) {
      return;
    }
    if (state.host?.isConnected) {
      return;
    }
    state.reconcileQueued = true;
    queueMicrotask(() => {
      state.reconcileQueued = false;
      if (state.requiredBy.size > 0 && !state.host?.isConnected) {
        createBadge(documentRef, state);
      }
    });
  });
  state.observer.observe(documentRef.documentElement, {
    childList: true,
    subtree: true
  });
}
function reconcileDocument(documentRef, state) {
  if (state.requiredBy.size > 0) {
    if (!state.host?.isConnected) {
      createBadge(documentRef, state);
    }
    ensureObserver(documentRef, state);
    return;
  }
  state.observer?.disconnect();
  state.observer = null;
  state.host?.remove();
  state.host = null;
  state.shadow = null;
}
function setBrandingContribution(token, required, documentRef = document) {
  const state = getState(documentRef);
  if (required) {
    state.requiredBy.add(token);
  } else {
    state.requiredBy.delete(token);
  }
  reconcileDocument(documentRef, state);
}
function removeBrandingContribution(token, documentRef = document) {
  const state = getState(documentRef);
  state.requiredBy.delete(token);
  reconcileDocument(documentRef, state);
}

// src/errors.ts
var LfeLiteError = class extends Error {
  code;
  operation;
  constructor(code, message, operation) {
    super(message);
    this.name = "LfeLiteError";
    this.code = code;
    this.operation = operation;
  }
};

// src/internal/license-lifecycle.ts
var MAX_TIMER_DELAY_MS = 2147e6;
var EXPIRY_REFRESH_TOLERANCE_MS = 50;
function parseExpiryMs(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function nextExpiryDelayMs(expiresAtMs, nowMs) {
  const remaining = expiresAtMs + EXPIRY_REFRESH_TOLERANCE_MS - nowMs;
  if (remaining <= 0) {
    return 0;
  }
  return Math.min(remaining, MAX_TIMER_DELAY_MS);
}

// src/seqset.ts
var LfeSeqSet = class {
  #transport;
  #handleId;
  #released = false;
  constructor(transport, handleId) {
    this.#transport = transport;
    this.#handleId = handleId;
  }
  async size() {
    this.#assertUsable("seqset_size");
    return await this.#transport.request("seqset_size", {
      handleId: this.#handleId
    });
  }
  async isEmpty() {
    this.#assertUsable("seqset_is_empty");
    return await this.#transport.request("seqset_is_empty", {
      handleId: this.#handleId
    });
  }
  async has(seq) {
    this.#assertUsable("seqset_has");
    assertSeq(seq, "has");
    return await this.#transport.request("seqset_has", {
      handleId: this.#handleId,
      seq
    });
  }
  async first(limit) {
    this.#assertUsable("seqset_first");
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 4294967295) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "limit must be a uint32 integer",
        "first"
      );
    }
    const value = await this.#transport.request("seqset_first", {
      handleId: this.#handleId,
      limit
    });
    if (Array.isArray(value)) {
      return value;
    }
    if (value instanceof BigUint64Array) {
      return Array.from(value);
    }
    throw new LfeLiteError(
      "WORKER_PROTOCOL_ERROR",
      "Worker returned an invalid SeqSet materialization",
      "first"
    );
  }
  async release() {
    if (this.#released) {
      return;
    }
    if (this.#transport.isClosed()) {
      throw new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", "release");
    }
    await this.#transport.request("seqset_release", {
      handleId: this.#handleId
    });
    this.#released = true;
  }
  #assertUsable(operation) {
    if (this.#transport.isClosed()) {
      throw new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", operation);
    }
    if (this.#released) {
      throw new LfeLiteError(
        "SEQSET_RELEASED",
        "LFE Lite SeqSet has been released",
        operation
      );
    }
  }
};
var MAX_U64 = (1n << 64n) - 1n;
function assertSeq(seq, operation) {
  if (typeof seq !== "bigint" || seq < 0n || seq > MAX_U64) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "seq must be a bigint in the uint64 range",
      operation
    );
  }
}

// src/seqset-ex.ts
var LfeSeqSetEx = class {
  #transport;
  #handleId;
  #released = false;
  constructor(transport, handleId) {
    this.#transport = transport;
    this.#handleId = handleId;
  }
  async size() {
    this.#assertUsable("seqsetex_size");
    return await this.#transport.request("seqsetex_size", {
      handleId: this.#handleId
    });
  }
  async isEmpty() {
    this.#assertUsable("seqsetex_is_empty");
    return await this.#transport.request("seqsetex_is_empty", {
      handleId: this.#handleId
    });
  }
  async remaining() {
    this.#assertUsable("seqsetex_remaining");
    return await this.#transport.request("seqsetex_remaining", {
      handleId: this.#handleId
    });
  }
  async nextChunk(maxItems) {
    this.#assertUsable("seqsetex_next_chunk");
    if (!Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > 4294967295) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "maxItems must be a uint32 integer",
        "nextChunk"
      );
    }
    const value = await this.#transport.request("seqsetex_next_chunk", {
      handleId: this.#handleId,
      maxItems
    });
    if (Array.isArray(value)) {
      return value;
    }
    if (value instanceof BigUint64Array) {
      return Array.from(value);
    }
    throw new LfeLiteError(
      "WORKER_PROTOCOL_ERROR",
      "Worker returned an invalid SeqSetEx chunk",
      "nextChunk"
    );
  }
  async release() {
    if (this.#released) return;
    if (this.#transport.isClosed()) {
      throw new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", "release");
    }
    await this.#transport.request("seqsetex_release", {
      handleId: this.#handleId
    });
    this.#released = true;
  }
  #assertUsable(operation) {
    if (this.#transport.isClosed()) {
      throw new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", operation);
    }
    if (this.#released) {
      throw new LfeLiteError(
        "SEQSET_RELEASED",
        "LFE Lite SeqSetEx has been released",
        operation
      );
    }
  }
};

// src/runtime.ts
var MAX_U642 = (1n << 64n) - 1n;
var MAX_U32 = 4294967295;
var SUPPORTED_TYPES = /* @__PURE__ */ new Set(["bool", "uint32", "float64"]);
var LfeLite = class _LfeLite {
  #worker;
  #closed = false;
  #closing = false;
  #nextRequestId = 1;
  #pending = /* @__PURE__ */ new Map();
  #licenseState = null;
  #expiresAtMs = null;
  #evaluatedExpiryMs = null;
  #expiryTimer = null;
  #refreshInFlight = null;
  #brandingToken = {};
  #lifecycleListenersInstalled = false;
  #onFocus = () => {
    this.#handleResume();
  };
  #onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      this.#handleResume();
    }
  };
  constructor(worker) {
    this.#worker = worker;
    worker.addEventListener("message", (event) => {
      this.#handleResponse(event.data);
    });
    worker.addEventListener("error", () => {
      this.#terminateUnexpectedly();
    });
    worker.addEventListener("messageerror", () => {
      this.#terminateUnexpectedly();
    });
  }
  static async create(options = {}) {
    if (typeof window === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      throw new LfeLiteError(
        "SDK_NOT_SUPPORTED",
        "LFE Lite requires a modern browser with Worker and WebAssembly support",
        "create"
      );
    }
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
      name: "lfe-lite"
    });
    const runtime = new _LfeLite(worker);
    const payload = {
      engine: options.engine ?? "compact",
      runtimeHostname: window.location.hostname,
      license: options.license ?? null,
      nowUnixMs: Date.now()
    };
    try {
      const state = await runtime.#request(
        "bootstrap",
        payload
      );
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
  async licenseState() {
    if (this.#closed || this.#closing) {
      throw new LfeLiteError(
        "SDK_CLOSED",
        "LFE Lite runtime is closed",
        "licenseState"
      );
    }
    if (this.#licenseState === null) {
      const state = await this.#request(
        "license_state"
      );
      this.#applyLicenseState(state, Number.NEGATIVE_INFINITY);
    }
    return { ...this.#licenseState };
  }
  async setLicense(license) {
    if (license !== null && typeof license !== "string") {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "license must be a JSON string or null",
        "setLicense"
      );
    }
    const nowUnixMs = Date.now();
    const state = await this.#request("set_license", {
      license,
      nowUnixMs
    });
    this.#applyLicenseState(state, nowUnixMs);
    return { ...state };
  }
  async define(definition) {
    assertDefinition(definition);
    await this.#request("define", definition);
  }
  async add(seq, logical) {
    assertSeq2(seq, "add");
    assertLogicalRecord(logical, "add");
    await this.#request("add", { seq, logical });
  }
  async addBatch(batch) {
    assertBatch(batch);
    return await this.#request("add_batch", batch);
  }
  async update(seq, patch) {
    assertSeq2(seq, "update");
    assertLogicalRecord(patch, "update");
    await this.#request("update", { seq, patch });
  }
  async delete(seq) {
    assertSeq2(seq, "delete");
    await this.#request("delete", { seq });
  }
  async resolve(query) {
    assertQueryObject(query);
    const response = await this.#request("resolve", { query });
    if (!Number.isSafeInteger(response?.handleId) || response.handleId <= 0) {
      throw new LfeLiteError(
        "WORKER_PROTOCOL_ERROR",
        "Worker returned an invalid SeqSet handle",
        "resolve"
      );
    }
    return new LfeSeqSet(
      {
        request: (op, payload) => this.#request(op, payload),
        isClosed: () => this.#closed || this.#closing
      },
      response.handleId
    );
  }
  async resolveEx(query) {
    assertQueryObject(query, "resolveEx");
    const response = await this.#request("resolve_ex", { query });
    if (!Number.isSafeInteger(response?.handleId) || response.handleId <= 0) {
      throw new LfeLiteError(
        "WORKER_PROTOCOL_ERROR",
        "Worker returned an invalid SeqSetEx handle",
        "resolveEx"
      );
    }
    return new LfeSeqSetEx(
      {
        request: (op, payload) => this.#request(op, payload),
        isClosed: () => this.#closed || this.#closing
      },
      response.handleId
    );
  }
  async resolveBounded(query, boundary) {
    assertQueryObject(query, "resolveBounded");
    assertResolveBoundary(boundary);
    const response = await this.#request("resolve_bounded", {
      query,
      startSeq: boundary.startSeq,
      endSeq: boundary.endSeq
    });
    if (!Number.isSafeInteger(response?.handleId) || response.handleId <= 0) {
      throw new LfeLiteError(
        "WORKER_PROTOCOL_ERROR",
        "Worker returned an invalid SeqSet handle",
        "resolveBounded"
      );
    }
    return new LfeSeqSet(
      {
        request: (op, payload) => this.#request(op, payload),
        isClosed: () => this.#closed || this.#closing
      },
      response.handleId
    );
  }
  async projectionValidFromSeq() {
    return await this.#request("projection_valid_from_seq");
  }
  async purgeBefore(seqExclusive) {
    assertSeq2(seqExclusive, "purgeBefore");
    return await this.#request("purge_before", { seqExclusive });
  }
  async beginReconstruction(startSeq) {
    assertSeq2(startSeq, "beginReconstruction");
    await this.#request("begin_reconstruction", { startSeq });
  }
  async reconstructionAddBatch(batch) {
    assertBatch(batch, "reconstructionAddBatch");
    return await this.#request("reconstruction_add_batch", batch);
  }
  async reconstructionState() {
    const state = await this.#request("reconstruction_state");
    if (state === null) {
      return null;
    }
    return {
      startSeq: state.start_seq,
      endSeqExclusive: state.end_seq_exclusive,
      stagedRecords: state.staged_records
    };
  }
  async publishReconstruction() {
    return await this.#request("publish_reconstruction");
  }
  async abortReconstruction() {
    return await this.#request("abort_reconstruction");
  }
  async close() {
    if (this.#closed || this.#closing) {
      return;
    }
    this.#closing = true;
    this.#cleanupLifecycle();
    try {
      await this.#request("close", void 0, true);
    } finally {
      this.#closed = true;
      this.#closing = false;
      this.#worker.terminate();
      this.#rejectAll(
        new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", "close")
      );
    }
  }
  #installLifecycleListeners() {
    if (this.#lifecycleListenersInstalled) {
      return;
    }
    window.addEventListener("focus", this.#onFocus);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    this.#lifecycleListenersInstalled = true;
  }
  #applyLicenseState(state, evaluatedAtMs) {
    if (this.#closed || this.#closing) {
      return;
    }
    this.#licenseState = { ...state };
    this.#expiresAtMs = parseExpiryMs(state.expires_at);
    this.#evaluatedExpiryMs = this.#expiresAtMs !== null && this.#expiresAtMs <= evaluatedAtMs ? this.#expiresAtMs : null;
    this.#scheduleExpiryRefresh();
    setBrandingContribution(this.#brandingToken, state.branding_required);
  }
  #scheduleExpiryRefresh() {
    this.#clearExpiryTimer();
    if (this.#closed || this.#closing || this.#expiresAtMs === null || this.#evaluatedExpiryMs === this.#expiresAtMs) {
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
      void this.#refreshLicenseState().catch(() => void 0);
    }, delay);
  }
  #clearExpiryTimer() {
    if (this.#expiryTimer !== null) {
      clearTimeout(this.#expiryTimer);
      this.#expiryTimer = null;
    }
  }
  #handleResume() {
    if (this.#closed || this.#closing || this.#expiresAtMs === null) {
      return;
    }
    if (Date.now() >= this.#expiresAtMs) {
      if (this.#evaluatedExpiryMs === this.#expiresAtMs) {
        return;
      }
      void this.#refreshLicenseState().catch(() => void 0);
      return;
    }
    this.#scheduleExpiryRefresh();
  }
  #refreshLicenseState() {
    if (this.#refreshInFlight !== null) {
      return this.#refreshInFlight;
    }
    const nowUnixMs = Date.now();
    const refresh = this.#request("refresh_license", {
      nowUnixMs
    }).then((value) => {
      const state = value;
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
      }
    );
    return this.#refreshInFlight;
  }
  #cleanupLifecycle() {
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
  #request(op, payload, allowDuringClose = false) {
    if (this.#closed || this.#closing && !allowDuringClose) {
      return Promise.reject(
        new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", op)
      );
    }
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    const request = {
      protocol: WORKER_PROTOCOL_VERSION,
      requestId,
      op,
      payload
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
            op
          )
        );
      }
    });
  }
  #handleResponse(response) {
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
        pending.operation
      )
    );
  }
  #terminateUnexpectedly() {
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
        "LFE Lite Worker terminated unexpectedly"
      )
    );
  }
  #rejectAll(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
};
function assertSeq2(seq, operation) {
  if (typeof seq !== "bigint" || seq < 0n || seq > MAX_U642) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "seq must be a bigint in the uint64 range",
      operation
    );
  }
}
function assertResolveBoundary(boundary) {
  if (!boundary || typeof boundary !== "object") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "boundary must be an object",
      "resolveBounded"
    );
  }
  assertSeq2(boundary.startSeq, "resolveBounded");
  assertSeq2(boundary.endSeq, "resolveBounded");
  if (boundary.startSeq > boundary.endSeq) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "boundary.startSeq must be less than or equal to boundary.endSeq",
      "resolveBounded"
    );
  }
}
function assertDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition must be an object",
      "define"
    );
  }
  if (!Number.isInteger(definition.keyId) || definition.keyId < 0 || definition.keyId > MAX_U32) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition.keyId must be uint32",
      "define"
    );
  }
  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition.name must be a non-empty string",
      "define"
    );
  }
  if (!SUPPORTED_TYPES.has(definition.type)) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "definition.type is unsupported",
      "define"
    );
  }
}
function assertLogicalRecord(value, operation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "logical record must be an object",
      operation
    );
  }
}
function assertBatch(batch, operation = "addBatch") {
  if (!batch || typeof batch !== "object") {
    throw new LfeLiteError("INVALID_ARGUMENT", "batch must be an object", operation);
  }
  if (!(batch.seqs instanceof BigUint64Array)) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "batch.seqs must be BigUint64Array",
      operation
    );
  }
  if (!Array.isArray(batch.columns) || batch.columns.length === 0) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "batch.columns must be a non-empty array",
      operation
    );
  }
  for (const column of batch.columns) {
    if (!column || typeof column !== "object") {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column must be an object",
        operation
      );
    }
    if (!Number.isInteger(column.keyId) || column.keyId < 0 || column.keyId > MAX_U32) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column keyId must be uint32",
        operation
      );
    }
    if (!SUPPORTED_TYPES.has(column.type)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column type is unsupported",
        operation
      );
    }
    if (column.values.length !== batch.seqs.length) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "batch column length must match batch.seqs length",
        operation
      );
    }
    if (column.type === "bool" && !(column.values instanceof Uint8Array)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "bool batch column requires Uint8Array",
        operation
      );
    }
    if (column.type === "uint32" && !(column.values instanceof Uint32Array)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "uint32 batch column requires Uint32Array",
        operation
      );
    }
    if (column.type === "float64" && !(column.values instanceof Float64Array)) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "float64 batch column requires Float64Array",
        operation
      );
    }
  }
}
function assertQueryObject(query, operation = "resolve") {
  if (!query || typeof query !== "object" || typeof query.op !== "string") {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "query must be a query object",
      operation
    );
  }
}

// src/index.ts
var LFE_LITE_SDK_VERSION = "0.1.1";
export {
  LFE_LITE_SDK_VERSION,
  LfeLite,
  LfeLiteError,
  LfeSeqSet,
  LfeSeqSetEx
};
