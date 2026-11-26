import { beforeEach, describe, expect, test } from "bun:test";
import { migrate, rollback } from "@softistx/mongo/migrations";
import type { Db } from "mongodb";
import { freshMigrationDb } from "~/migrations";
import { categoriesSeed, id } from "./2026-11-26-categories.migration";

const list = [categoriesSeed];
const COUNT = 15;
let db: Db;

beforeEach(async () => {
  db = await freshMigrationDb(["categories"]);
});

describe(id, () => {
  test("up seeds the documents with their stamps, and a second run changes nothing", async () => {
    await migrate(db, list);
    const rows = await db.collection("categories").find({}).toArray();
    expect(rows).toHaveLength(COUNT);
    for (const row of rows) {
      expect(row["createdAt"]).toBeInstanceOf(Date);
      expect(row["version"]).toBe(0);
    }
    await db
      .collection("categories")
      .updateOne({ _id: rows[0]?._id as never }, { $set: { edited: true } });
    await migrate(db, list);
    expect(
      await db.collection("categories").countDocuments({ edited: true }),
    ).toBe(1);
    expect(await db.collection("categories").countDocuments()).toBe(COUNT);
  });

  test("down deletes exactly the seeded ids, and up runs again", async () => {
    await migrate(db, list);
    await db.collection("categories").insertOne({ _id: "KEPT" as never });
    await rollback(db, list, {});
    expect(
      (await db.collection("categories").find().toArray()).map(
        (d) => d._id as unknown,
      ),
    ).toEqual(["KEPT"]);
    await migrate(db, list);
    expect(await db.collection("categories").countDocuments()).toBe(COUNT + 1);
  });
});
