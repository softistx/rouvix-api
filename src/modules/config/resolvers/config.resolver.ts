import { isObjectIdString } from "@softistx/mongo";
import { ObjectId } from "mongodb";
import { requirePlatformAdmin, requireUser } from "@/auth/guards";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { i18n } from "@/i18n";
import { safePlaceNotFound } from "../config.errors";
import { fromGeoJson, labelIn } from "../config.utils";
import { includingInactive } from "./support";

const objectId = (id: string) => {
  if (!isObjectIdString(id)) throw safePlaceNotFound();
  return new ObjectId(id);
};

export const configResolvers: Resolvers = {
  Query: {
    countries: async (_, { includeInactive }, ctx) =>
      ctx.services.countries.list(
        await includingInactive(ctx, includeInactive),
      ),
    country: async (_, { code }, ctx) => {
      const country = await ctx.services.countries.active(code);
      return country ?? null;
    },
    categories: async (_, { includeInactive }, ctx) =>
      ctx.services.categories.list(
        await includingInactive(ctx, includeInactive),
      ),
    safePlaces: (_, { countryCode, city, first, after }, ctx) =>
      ctx.services.safePlaces.list({ countryCode, city }, { first, after }),
    safePlacesNear: (_, { point, radiusM, first, countryCode }, ctx) =>
      ctx.services.safePlaces.near(point, { radiusM, first, countryCode }),
    geocode: (_, { query, countryCode, first }, ctx) => {
      requireUser(ctx);
      return ctx.services.geocoding.search(query, {
        countryCode,
        limit: first,
      });
    },
    reverseGeocode: async (_, { point }, ctx) => {
      requireUser(ctx);
      return ctx.services.geocoding.reverse(point);
    },
  },
  Mutation: {
    setCountry: async (_, { input }, ctx) => {
      await requirePlatformAdmin(ctx);
      return ctx.services.countries.set(input);
    },
    setCategory: async (_, { input }, ctx) => {
      await requirePlatformAdmin(ctx);
      return ctx.services.categories.set({
        ...input,
        parent: input.parent ?? null,
      });
    },
    createSafePlace: async (_, { input }, ctx) => {
      await requirePlatformAdmin(ctx);
      return ctx.services.safePlaces.create({
        ...input,
        hours: input.hours ?? null,
      });
    },
    updateSafePlace: async (_, { id, input, version }, ctx) => {
      await requirePlatformAdmin(ctx);
      return ctx.services.safePlaces.update(
        objectId(id),
        { ...input, hours: input.hours ?? null },
        version,
      );
    },
    deleteSafePlace: async (_, { id }, ctx) => {
      await requirePlatformAdmin(ctx);
      return ctx.services.safePlaces.remove(objectId(id));
    },
  },
  Country: {
    code: (country) => country._id,
    name: (country) => labelIn(country.names, i18n.language()),
  },
  Category: {
    key: (category) => category._id,
    label: (category) => labelIn(category.labels, i18n.language()),
  },
  SafePlace: {
    id: (place) => place._id.toHexString(),
    location: (place) => fromGeoJson(place.location),
  },
};
