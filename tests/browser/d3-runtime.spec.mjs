import { expect, test } from "@playwright/test";

test("D3 proxies mutation, resolve, SeqSet lifecycle and typed batch", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");

  const result = await page.evaluate(async () => {
    const { LfeLite } = await import("/dist/index.js");
    const lfe = await LfeLite.create();

    await lfe.define({ keyId: 0, name: "status", type: "uint32" });
    await lfe.define({ keyId: 1, name: "active", type: "bool" });

    await lfe.add(10n, { status: 1, active: true });
    await lfe.add(20n, { status: 2, active: true });
    await lfe.add(30n, { status: 1, active: false });

    let duplicateCode = null;
    try {
      await lfe.add(10n, { status: 1, active: true });
    } catch (error) {
      duplicateCode = error.code;
    }

    await lfe.update(20n, { status: 1 });
    await lfe.delete(30n);

    await lfe.addBatch({
      seqs: new BigUint64Array([40n, 50n]),
      columns: [
        { keyId: 0, type: "uint32", values: new Uint32Array([1, 2]) },
        { keyId: 1, type: "bool", values: new Uint8Array([1, 1]) },
      ],
    });

    let invalidBatchCode = null;
    try {
      await lfe.addBatch({
        seqs: new BigUint64Array([60n, 70n]),
        columns: [
          { keyId: 0, type: "uint32", values: new Uint32Array([1]) },
        ],
      });
    } catch (error) {
      invalidBatchCode = error.code;
    }

    const set = await lfe.resolve({
      op: "and",
      args: [
        { op: "eq", key: "status", value: 1 },
        { op: "eq", key: "active", value: true },
      ],
    });

    const size = await set.size();
    const empty = await set.isEmpty();
    const has10 = await set.has(10n);
    const has30 = await set.has(30n);
    const first = await set.first(10);

    await set.release();
    await set.release();

    let releasedCode = null;
    try {
      await set.size();
    } catch (error) {
      releasedCode = error.code;
    }

    const state = await lfe.setLicense(null);

    const liveSet = await lfe.resolve({ op: "eq", key: "active", value: true });
    await lfe.close();

    let closedSeqSetCode = null;
    try {
      await liveSet.first(1);
    } catch (error) {
      closedSeqSetCode = error.code;
    }

    return {
      duplicateCode,
      invalidBatchCode,
      size,
      empty,
      has10,
      has30,
      first: first.map(String),
      releasedCode,
      closedSeqSetCode,
      licenseStatus: state.status,
    };
  });

  expect(result.duplicateCode).toBe("SeqConflict");
  expect(result.invalidBatchCode).toBe("INVALID_ARGUMENT");
  expect(result.size).toBe(3);
  expect(result.empty).toBe(false);
  expect(result.has10).toBe(true);
  expect(result.has30).toBe(false);
  expect(result.first).toEqual(["10", "20", "40"]);
  expect(result.releasedCode).toBe("SEQSET_RELEASED");
  expect(result.closedSeqSetCode).toBe("SDK_CLOSED");
  expect(result.licenseStatus).toBe("DEVELOPMENT");
});

test("D3 production host denies write while resolve remains callable", async ({ page }) => {
  await page.goto("http://app.customer.com:8280/tests/browser/fixture.html");

  const result = await page.evaluate(async () => {
    const { LfeLite } = await import("/dist/index.js");
    const lfe = await LfeLite.create();
    await lfe.define({ keyId: 0, name: "active", type: "bool" });

    let writeCode = null;
    try {
      await lfe.add(1n, { active: true });
    } catch (error) {
      writeCode = error.code;
    }

    const set = await lfe.resolve({ op: "eq", key: "active", value: true });
    const size = await set.size();
    await set.release();
    await lfe.close();

    return { writeCode, size };
  });

  expect(result.writeCode).toBe("LicenseWriteDenied");
  expect(result.size).toBe(0);
});


test("M13.2 exposes bounded resolve and plane-space lifecycle through the SDK", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");

  const result = await page.evaluate(async () => {
    const { LfeLite } = await import("/dist/index.js");
    const lfe = await LfeLite.create();

    await lfe.define({ keyId: 0, name: "status", type: "uint32" });
    await lfe.addBatch({
      seqs: new BigUint64Array([1n, 2n, 3n, 4n, 5n, 6n]),
      columns: [
        { keyId: 0, type: "uint32", values: new Uint32Array([1, 2, 1, 2, 1, 2]) },
      ],
    });

    const bounded = await lfe.resolveBounded(
      { op: "eq", key: "status", value: 1 },
      { startSeq: 3n, endSeq: 6n },
    );
    const boundedFirst = (await bounded.first(10)).map(String);
    await bounded.release();

    const purged = await lfe.purgeBefore(4n);
    const validAfterPurge = await lfe.projectionValidFromSeq();

    let unavailableCode = null;
    try {
      await lfe.resolveBounded(
        { op: "eq", key: "status", value: 1 },
        { startSeq: 3n, endSeq: 6n },
      );
    } catch (error) {
      unavailableCode = error.code;
    }

    await lfe.beginReconstruction(1n);
    await lfe.reconstructionAddBatch({
      seqs: new BigUint64Array([1n, 2n, 3n]),
      columns: [
        { keyId: 0, type: "uint32", values: new Uint32Array([1, 2, 1]) },
      ],
    });

    const staged = await lfe.reconstructionState();
    const published = await lfe.publishReconstruction();
    const validAfterPublish = await lfe.projectionValidFromSeq();

    const rebuilt = await lfe.resolveBounded(
      { op: "eq", key: "status", value: 1 },
      { startSeq: 1n, endSeq: 6n },
    );
    const rebuiltFirst = (await rebuilt.first(10)).map(String);
    await rebuilt.release();

    const abortedWithoutStage = await lfe.abortReconstruction();
    await lfe.close();

    return {
      boundedFirst,
      purged: String(purged),
      validAfterPurge: String(validAfterPurge),
      unavailableCode,
      staged: staged && {
        startSeq: String(staged.startSeq),
        endSeqExclusive: String(staged.endSeqExclusive),
        stagedRecords: staged.stagedRecords,
      },
      published: String(published),
      validAfterPublish: String(validAfterPublish),
      rebuiltFirst,
      abortedWithoutStage,
    };
  });

  expect(result.boundedFirst).toEqual(["3", "5"]);
  expect(result.purged).toBe("3");
  expect(result.validAfterPurge).toBe("4");
  expect(result.unavailableCode).toBe("ProjectionUnavailable");
  expect(result.staged).toEqual({
    startSeq: "1",
    endSeqExclusive: "4",
    stagedRecords: 3,
  });
  expect(result.published).toBe("3");
  expect(result.validAfterPublish).toBe("1");
  expect(result.rebuiltFirst).toEqual(["1", "3", "5"]);
  expect(result.abortedWithoutStage).toBe(false);
});
