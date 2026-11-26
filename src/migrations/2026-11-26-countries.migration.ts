import { defineMigration } from "@softistx/mongo/migrations";
import seeds from "./2026-11-26-countries/countries.json";
import { deleteCreatedDocuments, insertMissing } from "./kit";

export const id = "2026-11-26-countries";

// seeds `up` inserts what is missing, by `_id`, and never overwrites what the
// platform admin edited since; `down` deletes exactly the ids it seeds.
const documents = () => seeds;

export const countriesSeed = defineMigration({
  id,
  async up({ db, session }) {
    await insertMissing(
      { db, session, migration: id },
      "countries",
      documents(),
    );
  },
  async down({ db, session }) {
    await deleteCreatedDocuments(
      { db, session, migration: id },
      "countries",
      documents().map((document) => document._id),
    );
  },
});
