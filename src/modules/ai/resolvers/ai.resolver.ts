import { requireUser } from "@/auth/guards";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { photoNotFound } from "../ai.errors";

export const aiResolvers: Resolvers = {
  Mutation: {
    suggestFromPhoto: async (_, { input }, ctx) => {
      const viewer = requireUser(ctx);
      if (!/^[0-9a-f-]{36}$/.test(input.photoKey)) throw photoNotFound();
      return ctx.services.suggestions.suggest(viewer, {
        photoKey: input.photoKey,
        countryCode: input.countryCode,
        categoryKey: input.categoryKey ?? null,
        language: ctx.language,
      });
    },
  },
};
