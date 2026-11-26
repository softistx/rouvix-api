import { defineMigration } from "@softistx/mongo/migrations";
import { ObjectId } from "mongodb";
import seeds from "./2026-11-26-safe-places/safe-places.json";
import { deleteCreatedDocuments, insertMissing } from "./kit";

export const id = "2026-11-26-safe-places";

// One police station per city of the first two: Douala and Yaoundé (the
// platform admin completes the list). `up` inserts what is missing, by `_id`, and never overwrites what the
// platform admin edited since; `down` deletes exactly the ids it seeds.
const documents = () =>
  seeds.map((place) => ({
    ...place,
    _id: new ObjectId(place._id),
    deletedAt: null,
  }));

export const safePlacesSeed = defineMigration({
  id,
  async up({ db, session }) {
    await insertMissing(
      { db, session, migration: id },
      "safePlaces",
      documents(),
    );
  },
  async down({ db, session }) {
    await deleteCreatedDocuments(
      { db, session, migration: id },
      "safePlaces",
      documents().map((document) => document._id),
    );
  },
});
