import { defineMigration } from "@softistx/mongo/migrations";
import seeds from "./2026-11-26-categories/categories.json";
import { deleteCreatedDocuments, insertMissing } from "./kit";

export const id = "2026-11-26-categories";

// seeds `up` inserts what is missing, by `_id`, and never overwrites what the
// platform admin edited since; `down` deletes exactly the ids it seeds.
const documents = () => seeds;

export const categoriesSeed = defineMigration({
  id,
  async up({ db, session }) {
    await insertMissing(
      { db, session, migration: id },
      "categories",
      documents(),
    );
  },
  async down({ db, session }) {
    await deleteCreatedDocuments(
      { db, session, migration: id },
      "categories",
      documents().map((document) => document._id),
    );
  },
});
