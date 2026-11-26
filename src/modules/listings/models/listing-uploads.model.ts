import { defineCollection } from "@softistx/mongo";
import { z } from "zod";
import { accountId, actors } from "@/shared/actors";

// A photo a signed-in account uploaded to `/media/listing-photos`, recorded by
// the upload's response hook: `_id` is the media key. A listing may carry only
// the keys its author uploaded, each once.
export const listingUploads = defineCollection({
  name: "listingUploads",
  schema: z.object({
    _id: z.uuid(),
    accountId,
    contentType: z.string().min(1),
    size: z.number().int().min(0),
  }),
  timestamps: true,
  actors,
  indexes: [{ key: { accountId: 1, createdAt: -1 }, name: "uploads_account" }],
});
