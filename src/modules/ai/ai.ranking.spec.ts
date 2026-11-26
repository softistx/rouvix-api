import { describe, expect, test } from "bun:test";
import { AiError } from "@softistx/ai-core";
import { ObjectId } from "mongodb";
import { noEmbedder } from "@/embedder";
import { type Candidate, textRanker } from "@/modules/search";
import { fakeOllama } from "~/ai";
import { embeddingRanker } from "./ai.ranking";

const ids = [new ObjectId(), new ObjectId(), new ObjectId()] as const;
const candidates: Candidate[] = [
  { id: ids[0], textScore: 2 },
  { id: ids[1], textScore: 1.5 },
  { id: ids[2], textScore: 1 },
];
const order = (ranked: readonly Candidate[]) =>
  ranked.map((c) => ids.indexOf(c.id as (typeof ids)[number]));

// A vector of the stored length pointing at axis `n`.
const axis = (n: number) =>
  Array.from({ length: 768 }, (_, i) => (i === n ? 1 : 0));

describe("the embedding ranker", () => {
  test("re-orders the same candidates by meaning, adding none", async () => {
    const { embedder } = fakeOllama();
    const [query] = await embedder.embed(["lost phone"], "query");
    const ranker = embeddingRanker({
      embedder,
      // The third listing is the query's own meaning, the second another one,
      // the first has none and counts for its words alone.
      vectorsOf: async () =>
        new Map([
          [ids[1].toHexString(), axis(5)],
          [ids[2].toHexString(), query as number[]],
        ]),
      fallback: textRanker,
    });
    const ranked = await ranker.rank({ text: "lost phone" }, candidates);
    expect(order(ranked)).toEqual([2, 0, 1]);
    expect(ranked).toHaveLength(candidates.length);
  });

  test("keeps the text order when no listing has a vector", async () => {
    const ranker = embeddingRanker({
      embedder: fakeOllama().embedder,
      vectorsOf: async () => new Map(),
      fallback: textRanker,
    });
    expect(order(await ranker.rank({ text: "x" }, candidates))).toEqual([
      0, 1, 2,
    ]);
  });

  test("keeps the text order when the embedder is down or off", async () => {
    for (const embedder of [
      fakeOllama({ error: new AiError("MODEL_ERROR", "down") }).embedder,
      noEmbedder,
    ]) {
      const ranker = embeddingRanker({
        embedder,
        vectorsOf: async () => {
          throw new Error("never read");
        },
        fallback: textRanker,
      });
      expect(order(await ranker.rank({ text: "x" }, candidates))).toEqual([
        0, 1, 2,
      ]);
    }
  });
});
