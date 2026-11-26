import { anthropic } from "@softistx/ai-anthropic";
import {
  claudeDescriber,
  noDescriber,
  type ObjectDescriber,
} from "@/describer";
import { type Embedder, noEmbedder, ollamaEmbedder } from "@/embedder";
import { env } from "./env";

// The server's AI ports (spec §3): Claude where ANTHROPIC_API_KEY is set (else
// no suggestion), and the local Ollama where OLLAMA_URL is set (else nothing is
// embedded). Both through `@softistx/ai-*`, never a provider SDK.
export function serverDescriber(): ObjectDescriber {
  if (env.ANTHROPIC_API_KEY === undefined) return noDescriber;
  return claudeDescriber(
    anthropic({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }),
  );
}

export function serverEmbedder(): Embedder {
  return env.OLLAMA_URL === undefined
    ? noEmbedder
    : ollamaEmbedder(env.OLLAMA_URL);
}
