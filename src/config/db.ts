import { defineMongo, type MongoOf, openMongo } from "@softistx/mongo";
import * as collections from "../modules/collections";
import { env } from "./env";

export const mongoConfig = defineMongo({
  uri: env.MONGO_URI,
  collections,
  // Dev and tests create collections and indexes on first use; production
  // runs `bun run db:sync` (a dbAdmin role the app itself does not hold).
  autoSync: Bun.env.NODE_ENV !== "production",
  // The driver reruns nothing on a transient error: `retryWriteConflicts`
  // (src/shared/locked.ts) owns the retry, with its budget.
  transactions: { retryTransient: false },
});

export type AppMongo = MongoOf<typeof mongoConfig>;

export const mongo: AppMongo = await openMongo(mongoConfig);
