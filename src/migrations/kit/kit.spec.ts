import { beforeEach, describe, expect, test } from "bun:test";
import type { Db } from "mongodb";
import { freshMigrationDb, type RawDoc } from "~/migrations";
import {
  deleteCreatedTranslations,
  translationSeeds,
  upsertTranslations,
} from "./index";

let db: Db;
const ctx = () => ({ db, session: undefined, migration: "2026-11-25-spec" });

beforeEach(async () => {
  db = await freshMigrationDb();
});

describe("translationSeeds", () => {
  test("joins one flat file per language by key", () => {
    expect(
      translationSeeds({
        fr: { "a.errors.x": "x fr" },
        en: { "a.errors.x": "x en" },
      }),
    ).toEqual([{ key: "a.errors.x", texts: { fr: "x fr", en: "x en" } }]);
  });

  test("refuses a key a language lacks", () => {
    expect(() =>
      translationSeeds({ fr: { "a.errors.x": "x" }, en: {} }),
    ).toThrow('translation "a.errors.x" has no en text');
  });
});

describe("upsertTranslations", () => {
  test("adds a key with its namespace, and changes only the languages it names", async () => {
    await upsertTranslations(ctx(), [
      { key: "a.errors.x", texts: { fr: "un", en: "one" } },
    ]);
    await upsertTranslations(ctx(), [
      { key: "a.errors.x", texts: { en: "uno" } },
      { key: "a.errors.y", texts: { fr: "deux", en: "two" } },
    ]);
    const rows = await db
      .collection("translations")
      .find({}, { sort: { _id: 1 } })
      .toArray();
    expect(rows).toMatchObject([
      {
        _id: "a.errors.x",
        namespace: "a.errors",
        key: "x",
        texts: { fr: "un", en: "uno" },
      },
      { _id: "a.errors.y", texts: { fr: "deux", en: "two" } },
    ]);
  });

  test("refuses a seed that is not a key or a text, or a prototype key", async () => {
    await expect(
      upsertTranslations(ctx(), [{ key: "nodot", texts: { fr: "x" } }]),
    ).rejects.toThrow();
    await expect(
      upsertTranslations(ctx(), [{ key: "a.errors.x", texts: { fr: "" } }]),
    ).rejects.toThrow();
    await expect(
      upsertTranslations(ctx(), [{ key: "a.__proto__.x", texts: { fr: "x" } }]),
    ).rejects.toThrow();
  });
});

describe("deleteCreatedTranslations", () => {
  test("deletes exactly the keys it is given", async () => {
    await upsertTranslations(ctx(), [
      { key: "a.errors.x", texts: { fr: "un" } },
      { key: "a.errors.y", texts: { fr: "deux" } },
    ]);
    await deleteCreatedTranslations(ctx(), ["a.errors.x"]);
    await deleteCreatedTranslations(ctx(), []);
    const ids = await db.collection<RawDoc>("translations").distinct("_id");
    expect(ids).toEqual(["a.errors.y"]);
  });
});
