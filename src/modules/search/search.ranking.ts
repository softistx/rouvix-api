import type { ObjectId } from "mongodb";

// A listing a text query matched, in the order the text index scored it.
export interface Candidate {
  id: ObjectId;
  // MongoDB's text score.
  textScore: number;
}

// The ranking port (spec §4.4, slice 6): puts the candidates of a text query
// in the order a visitor reads them. It is passed explicitly, never defaulted:
// src/app.ts chooses the adapter. Today `textRanker` keeps the text index's
// order; slice 6's embeddings adapter will re-rank the same candidates by
// cosine similarity without the search service changing.
export interface ListingRanker {
  rank(
    query: { text: string },
    candidates: readonly Candidate[],
  ): Promise<readonly Candidate[]>;
}

// Plain text ranking: MongoDB's text score, best first (the candidates come
// sorted by it, then by day, newest first).
export const textRanker: ListingRanker = {
  rank: async (_query, candidates) => candidates,
};
