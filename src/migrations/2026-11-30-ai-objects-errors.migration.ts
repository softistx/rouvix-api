import { defineMigration } from "@softistx/mongo/migrations";
import en from "./2026-11-30-ai-objects-errors/translations.en.json";
import fr from "./2026-11-30-ai-objects-errors/translations.fr.json";
import {
  deleteCreatedTranslations,
  translationSeeds,
  upsertTranslations,
} from "./kit";

export const id = "2026-11-30-ai-objects-errors";

// The message of the AI pipeline's photo-not-found code. `down` deletes exactly the keys `up` created.
const seeds = () => translationSeeds({ fr, en });

export const aiObjectsErrors = defineMigration({
  id,
  async up({ db, session }) {
    await upsertTranslations({ db, session, migration: id }, seeds());
  },
  async down({ db, session }) {
    await deleteCreatedTranslations(
      { db, session, migration: id },
      seeds().map((seed) => seed.key),
    );
  },
});
