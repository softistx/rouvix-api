import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";
import { accountId, actors } from "@/shared/actors";

export const listingKind = z.enum(["LOST", "FOUND"]);
export type ListingKind = z.infer<typeof listingKind>;

export const listingStatus = z.enum([
  "DRAFT",
  "PENDING",
  "OPEN",
  "CLAIMED",
  "CLOSED",
  "EXPIRED",
  "REMOVED",
]);
export type ListingStatus = z.infer<typeof listingStatus>;

export const closeReason = z.enum(["RECOVERED", "GIVEN_UP", "OTHER"]);
export type CloseReason = z.infer<typeof closeReason>;

// Where a found item is kept now.
export const keptAt = z.enum(["WITH_FINDER", "AT_ORGANISATION", "AT_POLICE"]);
export type KeptAt = z.infer<typeof keptAt>;

// A photo that fails processing is dropped from the listing, not kept as a status.
export const photoStatus = z.enum(["PENDING", "READY"]);
export type PhotoStatus = z.infer<typeof photoStatus>;

// A listing, the declaration of a lost or a found item (spec §5.3). Platform
// data, not tenant data: `orgId` says the listing belongs to an organisation's
// register (its agents edit it), it is not a tenant field. `place.point` is the
// exact point the author gave; the public view never returns it for a private
// place (listings.utils.ts). `questions` hold the finder's expected answers and
// stay in the author's view only. The photos' keys are media keys: the bytes
// are served by the `/media/listing-photos` route, never a URL.
export const listings = defineCollection({
  name: "listings",
  schema: z.object({
    _id: id(),
    kind: listingKind,
    authorId: accountId,
    orgId: id().nullable().default(null),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    categoryKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    documentType: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .nullable()
      .default(null),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(2000).default(""),
    attributes: z.object({
      colours: z.array(z.string().trim().min(1).max(30)).max(5),
      brand: z.string().trim().min(1).max(60).nullable().default(null),
      marks: z.string().trim().min(1).max(300).nullable().default(null),
    }),
    photos: z.array(z.object({ key: z.uuid(), status: photoStatus })).max(5),
    place: z.object({
      label: z.string().trim().min(1).max(160),
      point: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      // A lost item's area, in metres (200 to 20 000); null for a found one.
      radiusM: z.number().int().nullable().default(null),
      // A found item's whereabouts; null for a lost one.
      keptAt: keptAt.nullable().default(null),
    }),
    // The day it was lost or found, at UTC midnight.
    date: z.date(),
    questions: z
      .array(
        z.object({
          prompt: z.string().trim().min(1).max(200),
          answer: z.string().trim().min(1).max(100),
        }),
      )
      .max(3),
    status: listingStatus,
    closedReason: closeReason.nullable().default(null),
    closedAt: z.date().nullable().default(null),
    publishedAt: z.date().nullable().default(null),
    expiresAt: z.date().nullable().default(null),
    extendedCount: z.number().int().min(0).default(0),
  }),
  timestamps: true,
  optimisticLock: true,
  actors,
  indexes: [
    { key: { authorId: 1, createdAt: -1 }, name: "listings_author" },
    { key: { status: 1, expiresAt: 1 }, name: "listings_status_expiry" },
    { key: { "photos.key": 1 }, name: "listings_photo_key" },
    { key: { orgId: 1, status: 1 }, name: "listings_org" },
  ],
});
