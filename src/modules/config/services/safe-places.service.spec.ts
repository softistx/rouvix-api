import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { mongo } from "@/config/db";
import { clearDatabase, resetConfig } from "~/db";
import { issuesOf, refusal } from "~/refusals";
import { CountriesService } from "./countries.service";
import { type SafePlaceInput, SafePlacesService } from "./safe-places.service";

const service = new SafePlacesService(mongo, new CountriesService(mongo));
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
});

const douala = { latitude: 4.0511, longitude: 9.7043 };
const input = (over: Partial<SafePlaceInput> = {}): SafePlaceInput => ({
  countryCode: "CM",
  city: "Douala",
  name: "Poste de police de test",
  kind: "POLICE",
  location: { latitude: 4.06, longitude: 9.71 },
  hours: null,
  ...over,
});
const codeOf = (promise: Promise<unknown>) =>
  refusal(promise).then((e) => e.extensions["code"]);

describe("the seed", () => {
  test("holds a police station for Douala and one for Yaoundé", async () => {
    const all = await service.list({}, { first: 20, after: null });
    expect(all.totalCount).toBe(2);
    expect(
      all.edges.map((e) => `${e.node.city}:${e.node.kind}`).sort(),
    ).toEqual(["Douala:POLICE", "Yaoundé:POLICE"]);
    expect(
      (await service.list({ city: "Douala" }, { first: 20, after: null }))
        .totalCount,
    ).toBe(1);
    expect(
      (await service.list({ countryCode: "FR" }, { first: 20, after: null }))
        .totalCount,
    ).toBe(0);
  });
});

describe("near", () => {
  test("orders the places by distance and gives it in metres, within the radius", async () => {
    const added = await service.create(
      input({ location: { latitude: 4.0522, longitude: 9.7043 } }),
    );
    const found = await service.near(douala, { radiusM: 5_000, first: 10 });
    expect(found.map((f) => f.place.name)).toEqual([
      "Commissariat central de Douala",
      "Poste de police de test",
    ]);
    expect(found[1]?.place._id.equals(added._id)).toBe(true);
    expect(found[1]?.distanceM).toBeGreaterThan(100);
    expect(found[1]?.distanceM).toBeLessThan(150);
    expect(found[0]?.distanceM).toBeLessThan(5);
  });

  test("leaves out what is past the radius, limits the count and filters by country", async () => {
    expect(
      await service.near(douala, { radiusM: 100, first: 10 }),
    ).toHaveLength(1);
    expect(
      await service.near(douala, { radiusM: 500_000, first: 1 }),
    ).toHaveLength(1);
    expect(
      await service.near(douala, {
        radiusM: 500_000,
        first: 10,
        countryCode: "CM",
      }),
    ).toHaveLength(2);
    expect(
      await service.near(douala, {
        radiusM: 500_000,
        first: 10,
        countryCode: "FR",
      }),
    ).toEqual([]);
  });

  test("an archived place is out of it", async () => {
    const [nearest] = await service.near(douala, { radiusM: 100, first: 1 });
    const place = nearest?.place as { _id: ObjectId };
    await service.remove(place._id);
    expect(await service.near(douala, { radiusM: 100, first: 10 })).toEqual([]);
  });
});

describe("create, update and remove", () => {
  test("a place of an unknown or inactive country is refused on `countryCode`", async () => {
    expect(
      (await issuesOf(service.create(input({ countryCode: "ZZ" }))))[0]?.path,
    ).toBe("countryCode");
    await mongo.db.countries.update("CM", { active: false });
    expect(await codeOf(service.create(input()))).toBe(
      "config.errors.country-not-found",
    );
  });

  test("update replaces the fields, and locks on a version when one is given", async () => {
    const made = await service.create(input());
    const updated = await service.update(
      made._id,
      input({ name: "Renamed", hours: "24h/24" }),
      made.version,
    );
    expect(updated).toMatchObject({ name: "Renamed", hours: "24h/24" });
    expect(await codeOf(service.update(made._id, input(), made.version))).toBe(
      "config.errors.stale-version",
    );
    const free = await service.update(made._id, input({ name: "Again" }));
    expect(free.name).toBe("Again");
  });

  test("an unknown or archived place is not found", async () => {
    const made = await service.create(input());
    expect(await codeOf(service.update(new ObjectId(), input()))).toBe(
      "config.errors.safe-place-not-found",
    );
    expect(await service.remove(made._id)).toBe(made._id.toHexString());
    expect(await codeOf(service.remove(made._id))).toBe(
      "config.errors.safe-place-not-found",
    );
    expect(await codeOf(service.update(made._id, input()))).toBe(
      "config.errors.safe-place-not-found",
    );
  });
});

describe("list", () => {
  test("pages by city with the total", async () => {
    for (const n of [1, 2, 3])
      await service.create(input({ name: `Poste ${n}` }));
    const first = await service.list({}, { first: 3, after: null });
    expect(first.totalCount).toBe(5);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const next = await service.list(
      {},
      { first: 3, after: first.pageInfo.endCursor },
    );
    expect(next.edges).toHaveLength(2);
  });
});
