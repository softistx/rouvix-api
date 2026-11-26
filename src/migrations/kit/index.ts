// The append-only kit migrations write global collections with. It has no
// delete but `deleteCreatedTranslations` and `deleteCreatedDocuments`, for the
// `down` of a migration that only added messages or seed documents; `kit.spec.ts` keeps it so. Frozen: a function here
// never changes meaning, a new one is added instead, as the list of
// migrations grows only at its end.
export { inSession, type KitContext } from "./context";
export {
  deleteCreatedDocuments,
  deleteCreatedTranslations,
} from "./delete-created";
export { insertMissing } from "./seed-documents";
export { translationSeeds, upsertTranslations } from "./translations";
