import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";
import { accountId } from "@/shared/actors";

// A browser an account subscribed to Web Push: the push service's `endpoint`
// (unique: a browser belongs to one account, the last to subscribe) and the
// two keys that encrypt a payload for it. Secrets of their device, never
// returned by any resolver.
export const pushSubscriptions = defineCollection({
  name: "pushSubscriptions",
  schema: z.object({
    _id: id(),
    accountId,
    endpoint: z.string().max(2048),
    p256dh: z.string().max(128),
    auth: z.string().max(64),
  }),
  timestamps: true,
  indexes: [
    { key: { endpoint: 1 }, name: "push_endpoint", unique: true },
    { key: { accountId: 1, createdAt: -1 }, name: "push_account" },
  ],
});
