import type { Embedder } from "@/embedder";
import type { ListingEmbeddings, ListingsService } from "@/modules/listings";
import { embeddingTextOf, textHashOf } from "../ai.rules";

export interface EmbeddingDeps {
  embedder: Embedder;
  // The listings module's own: it reads the listing and keeps the vector.
  listings: Pick<ListingsService, "find">;
  vectors: Pick<ListingEmbeddings, "store">;
  pause: (ms: number) => Promise<void>;
}

const ATTEMPTS = 3;

// The embedding job (spec §4.4, §5.5): each open listing's text (title,
// description, attributes; never an ID document's, which is not embedded at
// all) is embedded on this machine and stored on the listing. It runs in the
// background after a publish and after each edit; a text that did not change is
// not embedded again. A failure is logged, never thrown at anybody: the
// listing is searchable by its words without a vector.
export class EmbeddingsService {
  constructor(private readonly deps: EmbeddingDeps) {}

  async index(listingId: string): Promise<void> {
    if (!this.deps.embedder.enabled) return;
    try {
      await this.embedWithRetry(listingId);
    } catch (error) {
      console.error(
        `rouvix-api: listing ${listingId} not embedded: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
    }
  }

  private async embedWithRetry(listingId: string) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.embedOnce(listingId);
      } catch (error) {
        if (attempt >= ATTEMPTS) throw error;
        await this.deps.pause(attempt * 500);
      }
    }
  }

  private async embedOnce(listingId: string) {
    const { embedder, listings, vectors } = this.deps;
    const listing = await listings.find(listingId);
    if (listing?.status !== "OPEN") return;
    const text = embeddingTextOf(listing);
    if (text === null) return;
    const textHash = textHashOf(text);
    if (
      listing.embedding?.textHash === textHash &&
      listing.embedding.model === embedder.model
    ) {
      return;
    }
    const [vector] = await embedder.embed([text], "document");
    if (vector === undefined) return;
    // Stored under the version read: a listing edited meanwhile keeps its own
    // job's vector, not this one's.
    await vectors.store(listing._id.toHexString(), listing.version, {
      model: embedder.model,
      textHash,
      vector,
    });
  }
}
