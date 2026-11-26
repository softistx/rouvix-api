import { beforeEach, describe, expect, test } from "bun:test";
import { migrate, rollback } from "@softistx/mongo/migrations";
import { type Db, ObjectId } from "mongodb";
import { freshMigrationDb } from "~/migrations";
import {
  id,
  listingsIdFields,
} from "./2026-11-29-listings-id-fields.migration";

const list = [listingsIdFields];
const KEY = "00000000-0000-4000-8000-000000000001";
let db: Db;

beforeEach(async () => {
  db = await freshMigrationDb(["listings"]);
});

describe(id, () => {
  test("up gives a listing and its photos the ID fields, null, once", async () => {
    const old = {
      _id: new ObjectId(),
      photos: [{ key: KEY, status: "READY" }],
    };
    const read = {
      _id: new ObjectId(),
      photos: [],
      idFields: "v1.sealed",
      idNumberHash: "a".repeat(64),
      public: { maskedNumber: "99••••", holderHint: "Jean E." },
    };
    await db.collection("listings").insertMany([old, read] as never);
    await migrate(db, list);
    expect(
      await db.collection("listings").findOne({ _id: old._id }),
    ).toMatchObject({
      idFields: null,
      idNumberHash: null,
      public: { maskedNumber: null, holderHint: null },
      photos: [{ key: KEY, status: "READY", blurredKey: null }],
    });
    expect(
      await db.collection("listings").findOne({ _id: read._id }),
    ).toMatchObject({ idFields: "v1.sealed", public: read.public });
  });

  test("down unsets them, and up runs again", async () => {
    await db
      .collection("listings")
      .insertOne({ photos: [{ key: KEY, status: "READY" }] } as never);
    await migrate(db, list);
    await rollback(db, list, {});
    const row = await db.collection("listings").findOne({});
    expect(row).not.toHaveProperty("idFields");
    expect(row).not.toHaveProperty("public");
    expect(row?.["photos"]).toEqual([{ key: KEY, status: "READY" }]);
    await migrate(db, list);
    expect(await db.collection("listings").findOne({})).toHaveProperty(
      "idNumberHash",
      null,
    );
  });
});
