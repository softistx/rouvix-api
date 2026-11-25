import { mongo } from "@/config/db";

// A database of its own on the test replica set, for the specs that run
// migrations from scratch (the shared one is migrated once, by test/setup.ts,
// and `clearDatabase` keeps what they wrote). Emptied on each call; the
// collections a migration writes exist beforehand, as `bun run db:sync`
// leaves them in production (a transaction cannot create one).
export type RawDoc = { _id: string } & Record<string, unknown>;

export async function freshMigrationDb(
  collections: readonly string[] = ["translations"],
) {
  const db = mongo.db.client.db("rouvix-migrations-test");
  if (!db.databaseName.endsWith("-test")) {
    throw new Error(`freshMigrationDb: refusing database ${db.databaseName}`);
  }
  await db.dropDatabase();
  for (const name of collections) await db.createCollection(name);
  return db;
}
