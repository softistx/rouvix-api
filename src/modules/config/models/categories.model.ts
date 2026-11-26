import { defineCollection } from "@softistx/mongo";
import { z } from "zod";
import { actors } from "@/shared/actors";
import { localizedText } from "./countries.model";

// A category of item: a two-level tree (`parent` is a root's key or null),
// global platform data like `countries`. `_id` is the key. A document category
// (`isDocument`) sends its photo to the local OCR and blur, never to a remote
// service (spec §4.2); the children of `DOCUMENT` are the document types.
export const categories = defineCollection({
  name: "categories",
  schema: z.object({
    _id: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    labels: localizedText,
    parent: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .nullable()
      .default(null),
    isDocument: z.boolean(),
    order: z.number().int().min(0).max(10_000),
    active: z.boolean().default(true),
  }),
  timestamps: true,
  optimisticLock: true,
  actors,
  indexes: [{ key: { parent: 1, order: 1 }, name: "categories_parent_order" }],
});
