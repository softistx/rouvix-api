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
