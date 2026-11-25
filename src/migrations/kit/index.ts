// The append-only kit migrations write global collections with. It has no
// delete but `deleteCreatedTranslations`, for the `down` of a migration that
// only added messages; `kit.spec.ts` keeps it so. Frozen: a function here
// never changes meaning, a new one is added instead, as the list of
// migrations grows only at its end.
export { inSession, type KitContext } from "./context";
export { deleteCreatedTranslations } from "./delete-created";
export { translationSeeds, upsertTranslations } from "./translations";
