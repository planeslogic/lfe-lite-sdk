export const WORKER_PROTOCOL_VERSION = 1 as const;

export type EngineMode = "compact" | "standard";

export interface BootstrapPayload {
  engine: EngineMode;
  runtimeHostname: string;
  license: string | null;
  nowUnixMs: number;
}

export interface RefreshLicensePayload {
  nowUnixMs: number;
}

export type WorkerOperation =
  | "bootstrap"
  | "license_state"
  | "set_license"
  | "refresh_license"
  | "define"
  | "add"
  | "add_batch"
  | "update"
  | "delete"
  | "resolve"
  | "resolve_bounded"
  | "projection_valid_from_seq"
  | "purge_before"
  | "begin_reconstruction"
  | "reconstruction_add_batch"
  | "reconstruction_state"
  | "publish_reconstruction"
  | "abort_reconstruction"
  | "seqset_size"
  | "seqset_is_empty"
  | "seqset_has"
  | "seqset_first"
  | "seqset_release"
  | "close";

export interface WorkerRequest {
  protocol: typeof WORKER_PROTOCOL_VERSION;
  requestId: number;
  op: WorkerOperation;
  payload?: unknown;
}

export interface WorkerSuccess {
  protocol: typeof WORKER_PROTOCOL_VERSION;
  requestId: number;
  ok: true;
  value?: unknown;
}

export interface WorkerFailure {
  protocol: typeof WORKER_PROTOCOL_VERSION;
  requestId: number;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type WorkerResponse = WorkerSuccess | WorkerFailure;
