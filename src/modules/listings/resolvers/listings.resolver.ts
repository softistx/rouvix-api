import { requireUser } from "@/auth/guards";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { fromGeoJson } from "@/modules/config";
import { listingIdOf } from "../listings.errors";
import { dateString, publicPoint } from "../listings.utils";
import { publicPhotoKeys } from "../rules";
import { declarer, editorOf } from "./support";

// The author's own view maps the document; the visitor's masks it here, field
// by field: nothing of the author, the exact point of a private place, the
// questions, an ID document's text or an ID photo's own key is returned to a
// visitor. No resolver returns `idFields` or `idNumberHash`, to anyone.
export const listingResolvers: Resolvers = {
  Query: {
    listing: (_, { id }, ctx) =>
      ctx.services.listings.publicById(listingIdOf(id)),
    myListings: (_, { first, after }, ctx) =>
      ctx.services.listings.mine(requireUser(ctx), { first, after }),
    myListing: async (_, { id }, ctx) => (await editorOf(ctx, id)).listing,
  },
  Mutation: {
    declareListing: async (_, { input }, ctx) => {
      const { viewer, orgId } = await declarer(ctx, input.organisationSlug);
      const { kind, content, publish } = input;
      return ctx.services.listings.declare(
        viewer,
        { ...content, kind, publish },
        orgId,
      );
    },
    updateListing: async (_, { id, input, version, publish }, ctx) => {
      const { viewer } = await editorOf(ctx, id);
      return ctx.services.listings.update(viewer, id, input, version, publish);
    },
    extendListing: async (_, { id }, ctx) => {
      const { viewer } = await editorOf(ctx, id);
      return ctx.services.listings.extend(viewer, id);
    },
    closeListing: async (_, { id, reason }, ctx) => {
      const { viewer } = await editorOf(ctx, id);
      return ctx.services.listings.close(viewer, id, reason);
    },
    removeListing: async (_, { id }, ctx) => {
      const { viewer } = await editorOf(ctx, id);
      return ctx.services.listings.remove(viewer, id);
    },
  },
  Listing: {
    id: (listing) => listing._id.toHexString(),
    date: (listing) => dateString(listing.date),
    maskedNumber: (listing) => listing.public.maskedNumber,
    holderHint: (listing) => listing.public.holderHint,
    place: (listing) => ({
      ...listing.place,
      point: fromGeoJson(listing.place.point),
    }),
    organisationSlug: (listing, _, ctx) =>
      listing.orgId === null
        ? null
        : ctx.services.organisations.slugOf(listing.orgId),
  },
  PublicListing: {
    id: (listing) => listing._id.toHexString(),
    date: (listing) => dateString(listing.date),
    title: (listing) => (listing.documentType === null ? listing.title : null),
    description: (listing) =>
      listing.documentType === null ? listing.description : null,
    attributes: (listing) =>
      listing.documentType === null ? listing.attributes : null,
    photoKeys: (listing) => publicPhotoKeys(listing).photoKeys,
    blurredPhotoKeys: (listing) => publicPhotoKeys(listing).blurredPhotoKeys,
    maskedNumber: (listing) => listing.public.maskedNumber,
    holderHint: (listing) => listing.public.holderHint,
    place: ({ place, documentType }) => ({
      // The author's words are withheld for an item kept at home and for an
      // ID document.
      label:
        place.keptAt === "WITH_FINDER" || documentType !== null
          ? null
          : place.label,
      point: publicPoint(fromGeoJson(place.point), place.keptAt),
      radiusM: place.radiusM,
      keptAt: place.keptAt,
      // An ID document's town could be its holder's: withheld like its label.
      city: documentType === null ? place.city : null,
    }),
    organisationSlug: (listing, _, ctx) =>
      listing.orgId === null
        ? null
        : ctx.services.organisations.slugOf(listing.orgId),
  },
};
