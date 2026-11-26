// The port to the object describer (spec §3, §4.3): given the photo of an
// object, it proposes a description the author accepts or edits. It is the
// only door to Claude, and `RemotePhotoGuard` (src/modules/ai) is the only
// caller: a photo reaches it after the guard let it through. A module takes it
// as a required parameter, never defaulted but at the app's entry point
// (`createApp`); specs pass `@softistx/ai-testing`'s fakes and never reach a
// provider.

// Bumped with any change of the prompt or of the answer's schema, and returned
// with every suggestion so a client or a log knows what produced it.
export const PROMPT_VERSION = 1;
export const SCHEMA_VERSION = 1;

export interface DescribedPhoto {
  bytes: Uint8Array;
  // `image/jpeg`, `image/png`, `image/webp` or `image/gif`.
  mediaType: string;
}

// A category the model may name: a root, active, not a document's.
export interface DescribableCategory {
  key: string;
  label: string;
}

export interface DescribeOptions {
  categories: readonly DescribableCategory[];
  // The language the words are written in: `fr` or `en`.
  language: string;
}

// What the model proposed, as it said it: UNTRUSTED (src/modules/ai/ai.rules.ts
// cleans and bounds it before anything returns it).
export interface RawDescription {
  category: string | null;
  title: string;
  description: string;
  colours: string[];
  brand: string | null;
  marks: string | null;
}

export interface Described {
  description: RawDescription;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ObjectDescriber {
  describe(
    photo: DescribedPhoto,
    options: DescribeOptions,
    signal?: AbortSignal,
  ): Promise<Described>;
}

// The provider refused, did not answer, or answered what the schema rejects.
export class DescriberError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DescriberError";
  }
}

// What runs without a key (development, a deployment without Claude): every
// call fails as a provider that is down, so the declare form goes without.
export const noDescriber: ObjectDescriber = {
  async describe() {
    throw new DescriberError("no Claude API key is configured");
  },
};
