import { defineMigration } from "@softistx/mongo/migrations";
import { inSession } from "./kit";

export const id = "2026-11-29-listings-id-fields";

// Gives the listings written before the ID document pipeline its fields:
// `idFields`, `idNumberHash` and `public` (null, nothing read yet), and each
// photo its `blurredKey` (null, no blurred copy yet). Adds fields only; `down`
// unsets them. A second run changes nothing (it touches what lacks them).
export const listingsIdFields = defineMigration({
  id,
  async up({ db, session }) {
    const ctx = { db, session, migration: id };
    const listings = db.collection("listings");
    const options = { ...inSession(ctx), bypassDocumentValidation: true };
    await listings.updateMany(
      { idFields: { $exists: false } },
      {
        $set: {
          idFields: null,
          idNumberHash: null,
          public: { maskedNumber: null, holderHint: null },
        },
      },
      options,
    );
    await listings.updateMany(
      { photos: { $elemMatch: { blurredKey: { $exists: false } } } },
      { $set: { "photos.$[photo].blurredKey": null } },
      {
        ...options,
        arrayFilters: [{ "photo.blurredKey": { $exists: false } }],
      },
    );
  },
  async down({ db, session }) {
    const ctx = { db, session, migration: id };
    await db.collection("listings").updateMany(
      {},
      {
        $unset: {
          idFields: "",
          idNumberHash: "",
          public: "",
          "photos.$[].blurredKey": "",
        },
      },
      { ...inSession(ctx), bypassDocumentValidation: true },
    );
  },
});
