import { inSession, type KitContext } from "./context";

// The actor a seed stamps: the system actor of src/shared/actors.ts, copied here
// because a migration imports nothing from the app.
const SEED_ACTOR = "00000000-0000-7000-8000-000000000000";

// Inserts the seed documents the collection does not hold yet, by `_id`, and
// touches no other: a seed never overwrites what the platform admin edited
// since (`$setOnInsert`), and a second run changes nothing. Each document
// carries its `_id` (a stable key or a frozen ObjectId) and its fields; the
// stamps are written here.
export async function insertMissing(
  ctx: KitContext,
  collection: string,
  documents: readonly { _id: unknown }[],
): Promise<void> {
  if (documents.length === 0) return;
  const now = new Date();
  await ctx.db.collection(collection).bulkWrite(
    documents.map(({ _id, ...fields }) => ({
      updateOne: {
        filter: { _id } as never,
        update: {
          $setOnInsert: {
            ...fields,
            createdAt: now,
            updatedAt: now,
            version: 0,
            createdBy: SEED_ACTOR,
            updatedBy: SEED_ACTOR,
            deletedBy: null,
          },
        },
        upsert: true,
      },
    })),
    inSession(ctx),
  );
}
