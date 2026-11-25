import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";
import { actors } from "@/shared/actors";

export const organisationKind = z.enum([
  "TOWN_HALL",
  "POLICE",
  "STATION",
  "SCHOOL",
  "HOTEL",
  "OTHER",
]);
export type OrganisationKind = z.infer<typeof organisationKind>;

// The tenant: every organisation-owned document carries its `_id` as
// `organisationId`. `slug` names it in URLs (`/:slug`) and is retired with it:
// an archived organisation keeps its slug, so a link never comes to name
// another one. `verifiedAt` is the "vérifié" badge, granted by the platform
// (a moderator, a later slice); an organisation starts unverified.
export const organisations = defineCollection({
  name: "organisations",
  schema: z.object({
    _id: id(),
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    kind: organisationKind,
    city: z.string().trim().min(1).max(120),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    verifiedAt: z.date().nullable().default(null),
  }),
  timestamps: true,
  softDelete: true,
  optimisticLock: true,
  actors,
  indexes: [
    { key: { slug: 1 }, unique: true, name: "organisations_slug_unique" },
  ],
});
