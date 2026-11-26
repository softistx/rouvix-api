import { beforeEach, describe, expect, test } from "bun:test";
import { migrate, rollback } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { freshMigrationDb } from "~/migrations";
import { id, safePlacesSeed } from "./2026-11-26-safe-places.migration";

const list = [safePlacesSeed];
const COUNT = 2;
let db: Db;

beforeEach(async () => {
  db = await freshMigrationDb(["safePlaces"]);
});

describe(id, () => {
  test("up seeds the documents with their stamps, and a second run changes nothing", async () => {
    await migrate(db, list);
    const rows = await db.collection("safePlaces").find({}).toArray();
    expect(rows).toHaveLength(COUNT);
    for (const row of rows) {
      expect(row["createdAt"]).toBeInstanceOf(Date);
      expect(row["version"]).toBe(0);
    }
    await db
      .collection("safePlaces")
      .updateOne({ _id: rows[0]?._id as never }, { $set: { edited: true } });
    await migrate(db, list);
    expect(
      await db.collection("safePlaces").countDocuments({ edited: true }),
    ).toBe(1);
    expect(await db.collection("safePlaces").countDocuments()).toBe(COUNT);
  });

  test("down deletes exactly the seeded ids, and up runs again", async () => {
    await migrate(db, list);
    await db.collection("safePlaces").insertOne({ _id: "KEPT" as never });
    await rollback(db, list, {});
    expect(
      (await db.collection("safePlaces").find().toArray()).map(
        (d) => d._id as unknown,
      ),
    ).toEqual(["KEPT"]);
    await migrate(db, list);
    expect(await db.collection("safePlaces").countDocuments()).toBe(COUNT + 1);
  });
});
