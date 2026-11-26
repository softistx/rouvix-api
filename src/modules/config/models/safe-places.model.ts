import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";
import { actors } from "@/shared/actors";

export const safePlaceKind = z.enum(["POLICE", "PARTNER_ORG"]);
export type SafePlaceKind = z.infer<typeof safePlaceKind>;

// A place to hand an item over: a police station, or a partner organisation
// that flagged itself (a later slice sets `orgId`). Global platform data.
// `location` is a GeoJSON point, `[longitude, latitude]`, behind a 2dsphere
// index (`safePlacesNear`). An archived place stays, out of every read.
export const safePlaces = defineCollection({
  name: "safePlaces",
  schema: z.object({
    _id: id(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    city: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    kind: safePlaceKind,
    location: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ]),
    }),
    hours: z.string().trim().min(1).max(200).nullable().default(null),
    orgId: id().nullable().default(null),
  }),
  timestamps: true,
  softDelete: true,
  optimisticLock: true,
  actors,
  indexes: [
    { key: { location: "2dsphere" }, name: "safe_places_location" },
    { key: { countryCode: 1, city: 1 }, name: "safe_places_city" },
  ],
});
