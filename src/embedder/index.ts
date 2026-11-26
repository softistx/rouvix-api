export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type Embedder,
  EmbedderError,
  type EmbeddingPurpose,
  noEmbedder,
} from "./embedder";
export { embedderOf, ollamaEmbedder } from "./ollama";
