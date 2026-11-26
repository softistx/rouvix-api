// The port to the embedder (spec §3, §4.4): the vectors of a text, on this
// machine. Passed explicitly, never defaulted but at `createApp`; specs pass
// `@softistx/ai-testing`'s `fakeEmbedder` through `embedderOf`.

// The model the vectors come from and their length, stored with each vector:
// two models' vectors, or two lengths', cannot be compared.
export const EMBEDDING_MODEL = "nomic-embed-text";
export const EMBEDDING_DIMENSIONS = 768;

// A text embedded as a stored document or as a search query (the model is
// trained with a prefix for each).
export type EmbeddingPurpose = "document" | "query";

export interface Embedder {
  // False for `noEmbedder`: nothing is embedded and nothing re-ranks.
  readonly enabled: boolean;
  readonly model: string;
  embed(
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    signal?: AbortSignal,
  ): Promise<number[][]>;
}

// The server did not answer, or answered vectors this app cannot use.
export class EmbedderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbedderError";
  }
}

// What runs without OLLAMA_URL: a disabled embedder.
export const noEmbedder: Embedder = {
  enabled: false,
  model: EMBEDDING_MODEL,
  async embed() {
    throw new EmbedderError("no Ollama server is configured");
  },
};
