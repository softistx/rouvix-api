import { defineMigration } from "@softistx/mongo/migrations";
import en from "./2026-11-25-initial-catalogues/translations.en.json";
import fr from "./2026-11-25-initial-catalogues/translations.fr.json";
import {
  deleteCreatedTranslations,
  translationSeeds,
  upsertTranslations,
} from "./kit";

export const id = "2026-11-25-initial-catalogues";

// The messages of the shared `auth` and `validation` codes, in French and English. `down` deletes exactly the keys `up` created.
const seeds = () => translationSeeds({ fr, en });

export const initialCatalogues = defineMigration({
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
