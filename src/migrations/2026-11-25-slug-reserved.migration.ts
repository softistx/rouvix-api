import { defineMigration } from "@softistx/mongo/migrations";
import en from "./2026-11-25-slug-reserved/translations.en.json";
import fr from "./2026-11-25-slug-reserved/translations.fr.json";
import {
  deleteCreatedTranslations,
  translationSeeds,
  upsertTranslations,
} from "./kit";

export const id = "2026-11-25-slug-reserved";

// The messages of the reserved organisation slugs' code. `down` deletes exactly the keys `up` created.
const seeds = () => translationSeeds({ fr, en });

export const slugReserved = defineMigration({
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
