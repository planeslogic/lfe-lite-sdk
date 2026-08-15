import { LfeLite } from "@planeslogic/lfe-lite";

const lfe = await LfeLite.create();

try {
  const result = await lfe.resolveEx({
    op: "and",
    args: [
      { op: "eq", key: "status", value: 2 },
      { op: "eq", key: "active", value: true },
    ],
  });

  try {
    while ((await result.remaining()) > 0) {
      const seqs = await result.nextChunk(4096);

      for (const seq of seqs) {
        console.log(seq);
      }
    }
  } finally {
    await result.release();
  }
} finally {
  await lfe.close();
}
