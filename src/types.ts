import type { EngineMode } from "./internal/protocol.js";

export interface LfeLiteOptions {
  license?: string | null;
  engine?: EngineMode;
}

export interface LfeLiteLicenseState {
  status: string;
  write_enabled: boolean;
  resolve_enabled: boolean;
  branding_required: boolean;
  license_id?: string | null;
  license_type?: string | null;
  domain?: string | null;
  expires_at?: string | null;
}

export type Seq = bigint;
export type LogicalValue = boolean | number;
export type LogicalRecord = Record<string, LogicalValue>;
export type LogicalType = "bool" | "uint32" | "float64";

export interface LogicalDefinition {
  keyId: number;
  name: string;
  type: LogicalType;
}

export interface LfeBatchColumn {
  keyId: number;
  type: LogicalType;
  values: Uint8Array | Uint32Array | Float64Array;
}

export interface LfeBatch {
  seqs: BigUint64Array;
  columns: LfeBatchColumn[];
}

export interface ResolveSeqBoundary {
  startSeq: bigint;
  endSeq: bigint;
}

export interface ReconstructionState {
  startSeq: bigint;
  endSeqExclusive: bigint;
  stagedRecords: number;
}

export type Query =
  | { op: "eq"; key: string; value: LogicalValue }
  | { op: "neq"; key: string; value: LogicalValue }
  | { op: "gt"; key: string; value: number }
  | { op: "gte"; key: string; value: number }
  | { op: "lt"; key: string; value: number }
  | { op: "lte"; key: string; value: number }
  | { op: "in"; key: string; values: LogicalValue[] }
  | { op: "and"; args: Query[] }
  | { op: "or"; args: Query[] }
  | { op: "not"; arg: Query };
