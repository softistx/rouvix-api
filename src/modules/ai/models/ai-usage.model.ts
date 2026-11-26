import { defineCollection } from "@softistx/mongo";
import { z } from "zod";

// What Claude was asked in one UTC day, for the whole platform (spec §5.5): the
// calls counted against the daily cap, and the tokens they spent. `_id` is
// `claude:YYYY-MM-DD`. Platform data, written by the usage service alone
// through atomic increments (no account stamps it), read by nobody else.
export const aiUsage = defineCollection({
  name: "aiUsage",
  schema: z.object({
    _id: z.string().regex(/^claude:\d{4}-\d{2}-\d{2}$/),
    calls: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
  }),
});
