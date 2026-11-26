import { requireUser } from "@/auth/guards";
import type { Resolvers } from "@/generated/graphql/resolvers";

export const aiResolvers: Resolvers = {
  Mutation: {
    suggestFromPhoto: async (_, { input }, ctx) => {
      const viewer = requireUser(ctx);
      return ctx.services.suggestions.suggest(viewer, {
        photoKey: input.photoKey,
        countryCode: input.countryCode,
        categoryKey: input.categoryKey ?? null,
        language: ctx.language,
      });
    },
  },
};
