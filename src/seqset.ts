import { LfeLiteError } from "./errors.js";

export interface SeqSetTransport {
  request(op: "seqset_size" | "seqset_is_empty" | "seqset_has" | "seqset_first" | "seqset_release", payload: unknown): Promise<unknown>;
  isClosed(): boolean;
}

export class LfeSeqSet {
  #transport: SeqSetTransport;
  #handleId: number;
  #released = false;

  constructor(transport: SeqSetTransport, handleId: number) {
    this.#transport = transport;
    this.#handleId = handleId;
  }

  async size(): Promise<number> {
    this.#assertUsable("seqset_size");
    return (await this.#transport.request("seqset_size", {
      handleId: this.#handleId,
    })) as number;
  }

  async isEmpty(): Promise<boolean> {
    this.#assertUsable("seqset_is_empty");
    return (await this.#transport.request("seqset_is_empty", {
      handleId: this.#handleId,
    })) as boolean;
  }

  async has(seq: bigint): Promise<boolean> {
    this.#assertUsable("seqset_has");
    assertSeq(seq, "has");
    return (await this.#transport.request("seqset_has", {
      handleId: this.#handleId,
      seq,
    })) as boolean;
  }

  async first(limit: number): Promise<bigint[]> {
    this.#assertUsable("seqset_first");
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 0xffff_ffff) {
      throw new LfeLiteError(
        "INVALID_ARGUMENT",
        "limit must be a uint32 integer",
        "first",
      );
    }

    const value = await this.#transport.request("seqset_first", {
      handleId: this.#handleId,
      limit,
    });

    if (Array.isArray(value)) {
      return value as bigint[];
    }
    if (value instanceof BigUint64Array) {
      return Array.from(value);
    }

    throw new LfeLiteError(
      "WORKER_PROTOCOL_ERROR",
      "Worker returned an invalid SeqSet materialization",
      "first",
    );
  }

  async release(): Promise<void> {
    if (this.#released) {
      return;
    }
    if (this.#transport.isClosed()) {
      throw new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", "release");
    }

    await this.#transport.request("seqset_release", {
      handleId: this.#handleId,
    });
    this.#released = true;
  }

  #assertUsable(operation: string): void {
    if (this.#transport.isClosed()) {
      throw new LfeLiteError("SDK_CLOSED", "LFE Lite runtime is closed", operation);
    }
    if (this.#released) {
      throw new LfeLiteError(
        "SEQSET_RELEASED",
        "LFE Lite SeqSet has been released",
        operation,
      );
    }
  }
}

const MAX_U64 = (1n << 64n) - 1n;

function assertSeq(seq: bigint, operation: string): void {
  if (typeof seq !== "bigint" || seq < 0n || seq > MAX_U64) {
    throw new LfeLiteError(
      "INVALID_ARGUMENT",
      "seq must be a bigint in the uint64 range",
      operation,
    );
  }
}
