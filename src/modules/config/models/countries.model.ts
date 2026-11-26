import { defineCollection } from "@softistx/mongo";
import { z } from "zod";
import { actors } from "@/shared/actors";

export const languageCode = z.enum(["FR", "EN"]);
export const localizedText = z.object({
  fr: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
});
export type LocalizedText = z.infer<typeof localizedText>;

// A country the platform serves: configuration, not code (spec §5.2). Global
// (no `organisationId`): platform data, written by migrations (the seed) and
// by the platform admin. `_id` is the ISO 3166-1 alpha-2 code. `documentTypes`
// are keys of document categories; `idNumberPatterns` are the regular
// expressions an ID number of that document type matches in this country.
export const countries = defineCollection({
  name: "countries",
  schema: z.object({
    _id: z.string().regex(/^[A-Z]{2}$/),
    names: localizedText,
    dialCode: z.string().regex(/^\+[1-9]\d{0,3}$/),
    phonePattern: z.string().min(1).max(200),
    documentTypes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(30),
    languages: z.array(languageCode).min(1),
    mapCenter: z.object({ latitude: z.number(), longitude: z.number() }),
    mapZoom: z.number().int().min(1).max(18),
    idNumberPatterns: z
      .array(
        z.object({
          documentType: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
          pattern: z.string().min(1).max(200),
        }),
      )
      .max(30),
    active: z.boolean().default(true),
  }),
  timestamps: true,
  optimisticLock: true,
  actors,
});
