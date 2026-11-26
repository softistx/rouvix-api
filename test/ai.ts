import { AiError, emptyUsage } from "@softistx/ai-core";
import { fakeEmbedder, fakeModel } from "@softistx/ai-testing";
import { claudeDescriber } from "@/describer";
import { EMBEDDING_DIMENSIONS, embedderOf } from "@/embedder";

// What a fake Claude answers by default: a drawn, harmless object.
export const defaultAnswer = {
  category: "PHONE",
  title: "Téléphone noir",
  description: "Un téléphone noir avec un étui, vu de face.",
  colours: ["noir"],
  brand: "Marque d'essai",
  marks: null,
};

// Claude as specs know it: the real describer over `@softistx/ai-testing`'s
// scripted model, so the prompt and the schema run for real and nothing leaves
// the process. `model.requests` is every call that reached it: a photo the
// guard refused never appears there. `answer` changes what it says, `fail()`
// makes it a provider that is down.
export function fakeClaude() {
  let answer: unknown = defaultAnswer;
  let failing = false;
  const model = fakeModel(() =>
    failing
      ? { error: new AiError("MODEL_ERROR", "fake Claude is down") }
      : {
          object: answer,
          usage: { ...emptyUsage(), inputTokens: 1200, outputTokens: 90 },
        },
  );
  return {
    model,
    describer: claudeDescriber(model),
    answer: (next: unknown) => {
      answer = next;
    },
    fail: () => {
      failing = true;
    },
    recover: () => {
      failing = false;
    },
  };
}

// The embedder as specs know it: the real one (prefixes, length check) over the
// deterministic fake of `@softistx/ai-testing`. `adapter.calls` is every batch
// of texts it was given.
export function fakeOllama(options: { error?: AiError } = {}) {
  const adapter = fakeEmbedder({
    dimensions: EMBEDDING_DIMENSIONS,
    ...options,
  });
  return { adapter, embedder: embedderOf(adapter) };
}
