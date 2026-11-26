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

// A photo of a listing. `key` is its private rendition (EXIF stripped, 1600
// px), the original as far as anybody may see one; `blurredKey` the strongly
// blurred copy the public sees instead, set for an ID document's photo and for
// any photo the local OCR found ID-like (spec §4.2): such a photo's own key is
// served to its listing's editors only.
export const listingPhoto = z.object({
  key: z.uuid(),
  status: photoStatus,
  blurredKey: z.uuid().nullable().default(null),
});
export type ListingPhoto = z.infer<typeof listingPhoto>;

// What a visitor reads of an ID document (spec §4.2): its number with all but
// its first two characters masked, and the holder's first name with their
// last name's initial. Null when the OCR read none.
export const publicIdText = z.object({
  maskedNumber: z.string().max(40).nullable().default(null),
  holderHint: z.string().max(60).nullable().default(null),
});

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
    photos: z.array(listingPhoto).max(5),
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
      // The town, as the author names it: a public filter, never an address.
      city: z.string().trim().min(1).max(80).nullable().default(null),
    }),
    // What search reads, derived from the content each time it is written
    // (`storedFields`, listings.utils.ts) and never returned as it is: `searchText` is the
    // words a visitor may match (never an ID document's text nor a place
    // label), `cityKey` the town folded for an exact match, `geo` the point a
    // visitor may filter and map by, blurred as a private place is shown.
    searchText: z.string().max(4000).default(""),
    cityKey: z.string().max(80).nullable().default(null),
    geo: z
      .object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]),
      })
      .nullable()
      .default(null),
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
    // An ID document's fields as the local OCR read them (number, names,
    // dates), sealed by the IdVault (src/vault): never in the schema, never
    // returned. `idNumberHash` is the keyed hash of the normalised number,
    // which matching compares. All three are cleared, with the photos, when
    // the listing closes or is removed.
    idFields: z.string().max(4000).nullable().default(null),
    idNumberHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
      .default(null),
    public: publicIdText.default({ maskedNumber: null, holderHint: null }),
  }),
  timestamps: true,
  optimisticLock: true,
  actors,
  indexes: [
    { key: { authorId: 1, createdAt: -1 }, name: "listings_author" },
    { key: { status: 1, expiresAt: 1 }, name: "listings_status_expiry" },
    // Unique: a media key is on one listing at most, whatever the races.
    {
      key: { "photos.key": 1 },
      name: "listings_photo_key",
      unique: true,
      sparse: true,
    },
    { key: { orgId: 1, status: 1 }, name: "listings_org" },
    // Matching (spec §6): an ID document's number, compared as its hash.
    {
      key: { idNumberHash: 1 },
      name: "listings_id_number",
      partialFilterExpression: { idNumberHash: { $type: "string" } },
    },
    // The blurred copies, which the media route looks a key up by.
    {
      key: { "photos.blurredKey": 1 },
      name: "listings_blurred_key",
      partialFilterExpression: { "photos.blurredKey": { $type: "string" } },
    },
    // Search (spec §5.4): the words, french and english alike (no stemming,
    // accents and case folded), the point, and the filters in their usual order.
    {
      key: { searchText: "text" },
      name: "listings_search_text",
      default_language: "none",
    },
    { key: { geo: "2dsphere" }, name: "listings_search_geo" },
    {
      key: { status: 1, kind: 1, categoryKey: 1, date: -1 },
      name: "listings_search_filters",
    },
  ],
});
