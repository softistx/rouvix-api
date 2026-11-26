import type { Resolvers } from "@/generated/graphql/resolvers";
import { throttleVisitor } from "@/throttle";

// Search and the map are open to everyone: no viewer is read, the caller's
// address is counted first, and what comes back is the documents the listings'
// masked resolvers (`PublicListing`) and the map's own types shape.
export const searchResolvers: Resolvers = {
  Query: {
    searchListings: async (_, { filter, first, after, orderBy }, ctx) => {
      await throttleVisitor(ctx);
      return ctx.services.search.search(
        filter ?? {},
        { first, after },
        orderBy ?? "DATE",
      );
    },
    mapListings: async (_, { bbox, filter, zoom }, ctx) => {
      await throttleVisitor(ctx);
      return ctx.services.map.map(bbox, filter ?? {}, zoom);
    },
  },
  PublicListingConnection: {
    counts: (page, _, ctx) => ctx.services.search.counts(page.filter),
  },
};
