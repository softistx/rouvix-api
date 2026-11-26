import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";
import { accountId } from "@/shared/actors";

// What a notice is about (spec §5.6): the three events an account chooses
// among in its settings.
export const notificationKind = z.enum(["MATCH", "MESSAGE", "CLAIM"]);
export type NotificationKind = z.infer<typeof notificationKind>;

// An in-app notice of one account (`accountId`, the only reader). It names the
// event and the listing it is about, never more: no title, no phone number, no
// ID data (the UI words it from its kind, and reads the listing through its own
// guards). Platform data written by `NotifyService` for any account, whoever
// the request's viewer is, so it stamps no actor.
export const notifications = defineCollection({
  name: "notifications",
  schema: z.object({
    _id: id(),
    accountId,
    kind: notificationKind,
    listingId: id().nullable().default(null),
    readAt: z.date().nullable().default(null),
  }),
  timestamps: true,
  indexes: [
    { key: { accountId: 1, createdAt: -1 }, name: "notifications_account" },
  ],
});
