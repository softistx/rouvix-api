import type { ObjectId } from "mongodb";
import { inSession, type KitContext } from "./context";

// For the `down` of a migration whose `up` only added messages: deletes exactly
// the keys it created, so a rollback leaves nothing behind. The kit's one
// delete, in a file of its own (kit.spec.ts exempts that file alone), and for a
// `down` alone: an `up` never deletes. A key `up` merely changed is put back
// with `upsertTranslations`, never listed here.
export async function deleteCreatedTranslations(
  ctx: KitContext,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  await ctx.db
    .collection<{ _id: string }>("translations")
    .deleteMany({ _id: { $in: [...keys] } }, inSession(ctx));
}

// The same for a migration whose `up` only inserted seed documents
// (`insertMissing`): deletes exactly the ids it listed from `collection`, in a
// `down` alone. A document the platform admin edited since is deleted too:
// rolling a seed back removes what the seed made.
export async function deleteCreatedDocuments(
  ctx: KitContext,
  collection: string,
  ids: readonly (string | ObjectId)[],
): Promise<void> {
  if (ids.length === 0) return;
  await ctx.db
    .collection<{ _id: string | ObjectId }>(collection)
    .deleteMany({ _id: { $in: [...ids] } }, inSession(ctx));
}
