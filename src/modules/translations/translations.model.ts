import { defineCollection } from "@softistx/mongo";
import { z } from "zod";

// A message in each language, global (no `organisationId`, read unscoped by
// `loadCatalogues` and written by migrations alone). `_id` is the full key,
// `<namespace>.<key>`, which for an API error is its code
// (`organisations.errors.last-admin`); `texts` are ICU messages, one per
// language. A key is never deleted but by the `down` of the migration that
// created it.
export const translationKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/);

export const languageCode = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/);

export const translations = defineCollection({
  name: "translations",
  schema: z.object({
    _id: translationKey,
    namespace: z.string().min(1),
    key: z.string().min(1),
    texts: z.record(languageCode, z.string().min(1)),
  }),
  timestamps: true,
  optimisticLock: true,
  indexes: [
    {
      key: { namespace: 1, key: 1 },
      unique: true,
      name: "translations_key",
    },
  ],
});
