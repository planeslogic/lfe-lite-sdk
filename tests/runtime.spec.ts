import { describe, expect, it } from "vitest";
import { LFE_LITE_CORE_COMMIT, LFE_LITE_CORE_VERSION } from "../internal/core-version.js";
import { WORKER_PROTOCOL_VERSION } from "../src/internal/protocol.js";
import { LfeSeqSet } from "../src/seqset.js";
import {
  EXPIRY_REFRESH_TOLERANCE_MS,
  MAX_TIMER_DELAY_MS,
  nextExpiryDelayMs,
  parseExpiryMs,
} from "../src/internal/license-lifecycle.js";


class FakeTransport {
  closed = false;
  calls: Array<{ op: string; payload: unknown }> = [];

  async request(op: "seqset_size" | "seqset_is_empty" | "seqset_has" | "seqset_first" | "seqset_release", payload: unknown): Promise<unknown> {
    this.calls.push({ op, payload });
    if (op === "seqset_size") return 2;
    if (op === "seqset_is_empty") return false;
    if (op === "seqset_has") return true;
    if (op === "seqset_first") return [1n, 2n];
    return undefined;
  }

  isClosed(): boolean {
    return this.closed;
  }
}

describe("D2 build contract", () => {
  it("pins the validated Core baseline", () => {
    expect(LFE_LITE_CORE_VERSION).toBe("v0.1.4");
    expect(LFE_LITE_CORE_COMMIT).toBe("d9a97cb");
  });

  it("locks Worker protocol version 1", () => {
    expect(WORKER_PROTOCOL_VERSION).toBe(1);
  });
});

describe("D3 SeqSet lifecycle", () => {
  it("proxies lazy SeqSet operations", async () => {
    const transport = new FakeTransport();
    const seqset = new LfeSeqSet(transport, 7);

    await expect(seqset.size()).resolves.toBe(2);
    await expect(seqset.isEmpty()).resolves.toBe(false);
    await expect(seqset.has(2n)).resolves.toBe(true);
    await expect(seqset.first(2)).resolves.toEqual([1n, 2n]);
  });

  it("release is idempotent and use-after-release rejects", async () => {
    const transport = new FakeTransport();
    const seqset = new LfeSeqSet(transport, 9);

    await seqset.release();
    await seqset.release();

    expect(transport.calls.filter((call) => call.op === "seqset_release")).toHaveLength(1);
    await expect(seqset.size()).rejects.toMatchObject({ code: "SEQSET_RELEASED" });
  });

  it("parent close invalidates a live SeqSet", async () => {
    const transport = new FakeTransport();
    const seqset = new LfeSeqSet(transport, 11);
    transport.closed = true;

    await expect(seqset.first(1)).rejects.toMatchObject({ code: "SDK_CLOSED" });
  });
});

describe("D4 license lifecycle scheduling", () => {
  it("parses RFC3339 expiry without making authorization decisions", () => {
    expect(parseExpiryMs("2026-08-09T14:00:00Z")).toBe(
      Date.parse("2026-08-09T14:00:00Z"),
    );
    expect(parseExpiryMs(null)).toBeNull();
    expect(parseExpiryMs("not-a-timestamp")).toBeNull();
  });

  it("chunks long browser timers", () => {
    const now = 1_000;
    const expiry = now + MAX_TIMER_DELAY_MS + 60_000;
    expect(nextExpiryDelayMs(expiry, now)).toBe(MAX_TIMER_DELAY_MS);
  });

  it("schedules the final refresh after the expiry tolerance", () => {
    const expiry = 10_000;
    expect(nextExpiryDelayMs(expiry, 9_900)).toBe(
      100 + EXPIRY_REFRESH_TOLERANCE_MS,
    );
    expect(nextExpiryDelayMs(expiry, expiry + EXPIRY_REFRESH_TOLERANCE_MS)).toBe(0);
  });
});
