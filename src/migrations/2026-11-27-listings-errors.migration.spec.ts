import { beforeEach, describe, expect, test } from "bun:test";
import { migrate, rollback } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { freshMigrationDb, type RawDoc } from "~/migrations";
import { id, listingsErrors } from "./2026-11-27-listings-errors.migration";

const list = [listingsErrors];
const created = [
  "listings.errors.listing-not-found",
  "listings.errors.category-invalid",
  "listings.errors.document-type-invalid",
  "listings.errors.photo-invalid",
  "listings.errors.invalid-status",
  "listings.errors.extension-limit",
  "listings.errors.stale-version",
];
let db: Db;

beforeEach(async () => {
  db = await freshMigrationDb();
});

const row = (key: string) =>
  db.collection<RawDoc>("translations").findOne({ _id: key });

describe(id, () => {
  test("up writes each message in both languages", async () => {
    await migrate(db, list);
    for (const key of created) {
      const texts = (await row(key))?.["texts"] as Record<string, string>;
      expect(Object.keys(texts ?? {}).sort()).toEqual(["en", "fr"]);
    }
  });

  test("down deletes exactly the keys up created, and up runs again", async () => {
    await migrate(db, list);
    await db
      .collection<RawDoc>("translations")
      .insertOne({ _id: "other.errors.kept", texts: { fr: "x" } });
    await rollback(db, list, {});
    for (const key of created) expect(await row(key)).toBeNull();
    expect(await row("other.errors.kept")).not.toBeNull();
    await migrate(db, list);
    expect(await row(created[0] as string)).not.toBeNull();
  });
});
