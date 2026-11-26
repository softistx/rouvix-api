import { defineCollection } from "@softistx/mongo";
import { z } from "zod";
import { accountId } from "@/shared/actors";

// An account's notification settings (spec §5.6), one document per account,
// made by its first `updateSettings`: an account without one holds the
// defaults (every event on, no e-mail copies, no previews; notifications.rules.ts).
// `_id` is the account's id. The language is the account's own (janus).
export const accountSettings = defineCollection({
  name: "accountSettings",
  schema: z.object({
    _id: accountId,
    notifyMatch: z.boolean(),
    notifyMessage: z.boolean(),
    notifyClaim: z.boolean(),
    emailCopies: z.boolean(),
    pushPreviews: z.boolean(),
  }),
  timestamps: true,
});
