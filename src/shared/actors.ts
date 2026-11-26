import { z } from "zod";

// Who wrote a document (`createdBy`, `updatedBy`, `deletedBy`): a janus
// account id, a UUIDv7 string. Every collection stamps the same type, so
// `mongo.as(viewer.id)` stamps them all.
export const accountId = z.uuid();

export const actors = { type: accountId };

// Who stamps the writes of a script no account runs (`bun run admin:create`):
// a fixed UUIDv7-shaped id, no janus account, documented in CONTEXT.md.
export const SYSTEM_ACTOR = "00000000-0000-7000-8000-000000000000";
