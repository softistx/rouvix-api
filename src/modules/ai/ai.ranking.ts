import type { Embedder } from "@/embedder";
import type { Candidate, ListingRanker } from "@/modules/search";
import { messageOf } from "@/shared/errors";
import { blendedScore, cosine } from "./ai.rules";

export interface EmbeddingRankerDeps {
  embedder: Embedder;
  // The stored vectors of these listings, by id (hex), for the embedder's model.
  vectorsOf: (
    ids: readonly Candidate["id"][],
    model: string,
  ) => Promise<ReadonlyMap<string, readonly number[]>>;
  // What orders the candidates when the embedder cannot be reached.
  fallback: ListingRanker;
}

// The search's ranking by meaning (spec §4.4, §5.4): the candidates the text
// index matched are re-ordered by their text score blended with the cosine
// similarity between the query's vector and each listing's (the query is
// embedded on this machine). Nothing is added to the candidates, so no
// listing the words did not match ever shows up. Embedder down, no vector at
// all: the text order, as the plain ranker gives it.
export function embeddingRanker(deps: EmbeddingRankerDeps): ListingRanker {
  return {
    async rank(query, candidates) {
      if (!deps.embedder.enabled || candidates.length < 2) {
        return deps.fallback.rank(query, candidates);
      }
      try {
        const [queryVector] = await deps.embedder.embed([query.text], "query");
        if (queryVector === undefined) {
          return deps.fallback.rank(query, candidates);
        }
        const vectors = await deps.vectorsOf(
          candidates.map((candidate) => candidate.id),
          deps.embedder.model,
        );
        const best = Math.max(...candidates.map((c) => c.textScore));
        const scored = candidates.map((candidate, position) => {
          const vector = vectors.get(candidate.id.toHexString());
          return {
            candidate,
            position,
            score: blendedScore(
              candidate.textScore,
              best,
              vector === undefined ? null : cosine(queryVector, vector),
            ),
          };
        });
        // Stable: equal scores keep the text order (score, then newest day).
        scored.sort((a, b) => b.score - a.score || a.position - b.position);
        return scored.map(({ candidate }) => candidate);
      } catch (error) {
        console.error(
          `rouvix-api: search ranked by its words only: ${messageOf(error)}`,
        );
        return deps.fallback.rank(query, candidates);
      }
    },
  };
}
