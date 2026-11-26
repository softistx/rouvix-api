import { describe, expect, test } from "bun:test";
import { AiError } from "@softistx/ai-core";
import { fakeEmbedder } from "@softistx/ai-testing";
import { fakeOllama } from "~/ai";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EmbedderError,
  noEmbedder,
} from "./index";
import { embedderOf } from "./ollama";

describe("the embedder", () => {
  test("gives one 768-long vector per text, with the model's task prefix", async () => {
    const { adapter, embedder } = fakeOllama();
    const vectors = await embedder.embed(["a bag", "keys"], "document");
    expect(vectors).toHaveLength(2);
    expect(vectors.every((v) => v.length === EMBEDDING_DIMENSIONS)).toBe(true);
    await embedder.embed(["a bag"], "query");
    expect(adapter.calls).toEqual([
      ["search_document: a bag", "search_document: keys"],
      ["search_query: a bag"],
    ]);
    expect(embedder.model).toBe(EMBEDDING_MODEL);
    expect(embedder.enabled).toBe(true);
  });

  test("a vector of another length is refused", async () => {
    const embedder = embedderOf(fakeEmbedder({ dimensions: 8 }));
    await expect(embedder.embed(["x"], "document")).rejects.toBeInstanceOf(
      EmbedderError,
    );
  });

  test("a server that fails is an embedder error", async () => {
    const { embedder } = fakeOllama({
      error: new AiError("MODEL_ERROR", "down"),
    });
    await expect(embedder.embed(["x"], "query")).rejects.toBeInstanceOf(
      EmbedderError,
    );
  });

  test("without a server, nothing is embedded", async () => {
    expect(noEmbedder.enabled).toBe(false);
    await expect(noEmbedder.embed(["x"], "query")).rejects.toBeInstanceOf(
      EmbedderError,
    );
  });
});
