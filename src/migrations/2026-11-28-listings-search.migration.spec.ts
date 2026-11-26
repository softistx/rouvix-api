import { beforeEach, describe, expect, test } from "bun:test";
import { migrate, rollback } from "@softistx/mongo/migrations";
import { type Db, ObjectId } from "mongodb";
import {
  cityKeyOf,
  searchPoint,
  searchTextOf,
} from "@/modules/listings/listings.utils";
import { freshMigrationDb } from "~/migrations";
import { derive } from "./2026-11-28-listings-search/derive";
import { id, listingsSearch } from "./2026-11-28-listings-search.migration";

const list = [listingsSearch];
let db: Db;

beforeEach(async () => {
  db = await freshMigrationDb(["listings"]);
});

const stored = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  title: "Sac rouge",
  description: "Perdu hier",
  documentType: null,
  attributes: { colours: ["rouge"], brand: "Marque", marks: null },
  place: {
    label: "Quelque part",
    point: { type: "Point", coordinates: [9.70456, 4.05123] },
    keptAt: null,
    city: " Douala ",
  },
  ...over,
});

describe(id, () => {
  test("up gives a listing without them the fields search reads, once", async () => {
    const old = stored();
    const done = stored({ searchText: "kept", cityKey: null, geo: null });
    await db.collection("listings").insertMany([old, done] as never);
    await migrate(db, list);
    expect(
      await db.collection("listings").findOne({ _id: old._id }),
    ).toMatchObject({
      searchText: "Sac rouge Perdu hier Marque rouge",
      cityKey: "douala",
      geo: { type: "Point", coordinates: [9.706, 4.052] },
    });
    // A listing that has them is left as it is.
    expect(
      await db.collection("listings").findOne({ _id: done._id }),
    ).toMatchObject({
      searchText: "kept",
    });
  });

  test("down unsets the three fields, and up runs again", async () => {
    await db.collection("listings").insertOne(stored() as never);
    await migrate(db, list);
    await rollback(db, list, {});
    const row = await db.collection("listings").findOne({});
    expect(row).not.toHaveProperty("searchText");
    expect(row).not.toHaveProperty("geo");
    await migrate(db, list);
    expect(await db.collection("listings").findOne({})).toHaveProperty(
      "searchText",
    );
  });

  test("the copy of the rules agrees with listings.utils on what it derives", () => {
    const points = [
      { latitude: 4.05123, longitude: 9.70456 },
      { latitude: 3.84812, longitude: 11.50234 },
      { latitude: -1.00049, longitude: 13.99951 },
    ];
    for (const keptAt of [
      null,
      "WITH_FINDER",
      "AT_POLICE",
      "AT_ORGANISATION",
    ] as const) {
      for (const p of points) {
        const doc = stored({
          documentType: keptAt === "AT_POLICE" ? "CNI" : null,
          place: {
            label: "x",
            point: { type: "Point", coordinates: [p.longitude, p.latitude] },
            keptAt,
            city: "Yaoundé",
          },
        });
        const derived = derive(doc as never);
        const point = searchPoint(p, keptAt);
        expect(derived.geo?.coordinates).toEqual([
          point.longitude,
          point.latitude,
        ]);
        expect(derived.cityKey).toBe(
          doc.documentType ? null : cityKeyOf("Yaoundé"),
        );
        expect(derived.searchText).toBe(
          searchTextOf({
            documentType: doc.documentType,
            title: doc.title,
            description: doc.description,
            attributes: doc.attributes,
          }),
        );
      }
    }
  });
});
