import {
  AiError,
  type EmbeddingAdapter,
  embed as embedAll,
} from "@softistx/ai-core";
import { ollamaEmbeddings } from "@softistx/ai-ollama";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type Embedder,
  EmbedderError,
  type EmbeddingPurpose,
} from "./embedder";

const TIMEOUT_MS = 10_000;
const BATCH = 16;

// nomic-embed-text is trained with a task prefix on every input.
const PREFIX: Record<EmbeddingPurpose, string> = {
  document: "search_document: ",
  query: "search_query: ",
};

// The embedder over any `EmbeddingAdapter` (Ollama's in production, the fake
// of @softistx/ai-testing in specs): the model's prefixes, one vector of the
// stored length per text, and one error type for every failure.
export function embedderOf(adapter: EmbeddingAdapter): Embedder {
  return {
    enabled: true,
    model: EMBEDDING_MODEL,
    async embed(texts, purpose, signal = AbortSignal.timeout(TIMEOUT_MS)) {
      try {
        const { vectors } = await embedAll(
          adapter,
          texts.map((text) => `${PREFIX[purpose]}${text}`),
          { batchSize: BATCH, signal },
        );
        if (vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
          throw new EmbedderError(
            `a vector is not ${EMBEDDING_DIMENSIONS} long`,
          );
        }
        return vectors;
      } catch (error) {
        if (error instanceof EmbedderError) throw error;
        if (error instanceof AiError) {
          throw new EmbedderError(`${error.code}: ${error.message}`, {
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}

// The local Ollama server at `baseUrl`, `nomic-embed-text` pulled into it.
export const ollamaEmbedder = (baseUrl: string): Embedder =>
  embedderOf(
    ollamaEmbeddings({
      model: EMBEDDING_MODEL,
      baseUrl,
      dimensions: EMBEDDING_DIMENSIONS,
      maxBatchSize: BATCH,
      keepAlive: "30m",
    }),
  );
