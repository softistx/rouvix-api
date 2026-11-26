import { defineMigration } from "@softistx/mongo/migrations";
import en from "./2026-11-29-ai-errors/translations.en.json";
import fr from "./2026-11-29-ai-errors/translations.fr.json";
import {
  deleteCreatedTranslations,
  translationSeeds,
  upsertTranslations,
} from "./kit";

export const id = "2026-11-29-ai-errors";

// The messages of the AI pipeline's codes. `down` deletes exactly the keys `up` created.
const seeds = () => translationSeeds({ fr, en });

export const aiErrors = defineMigration({
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
