import { defineMigration } from "@softistx/mongo/migrations";
import type { AnyBulkWriteOperation } from "mongodb";
import { derive } from "./2026-11-28-listings-search/derive";
import { inSession } from "./kit";

export const id = "2026-11-28-listings-search";

// Gives the listings written before search the fields it reads (`searchText`,
// `cityKey`, `geo`), derived from their content. Adds fields only; `down`
// unsets them. A second run changes nothing (it touches a listing without them).
export const listingsSearch = defineMigration({
  id,
  async up({ db, session }) {
    const ctx = { db, session, migration: id };
    const listings = db.collection("listings");
    const todo = listings.find(
      { searchText: { $exists: false } },
      { ...inSession(ctx), batchSize: 200 },
    );
    let batch: AnyBulkWriteOperation[] = [];
    const flush = async () => {
      if (batch.length > 0) {
        await listings.bulkWrite(batch, inSession(ctx));
        batch = [];
      }
    };
    for await (const doc of todo) {
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: derive(doc as never) },
        },
      });
      if (batch.length === 200) await flush();
    }
    await flush();
  },
  async down({ db, session }) {
    await db
      .collection("listings")
      .updateMany(
        {},
        { $unset: { searchText: "", cityKey: "", geo: "" } },
        session === undefined ? {} : { session },
      );
  },
});
