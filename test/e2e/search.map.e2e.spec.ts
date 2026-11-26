import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { graphql } from "~/generated/graphql";
import { foundContent, listingsAs } from "~/listings";
import { publishFound, publishLost } from "~/search";

// The map as a visitor: found items as markers or clusters, lost ones as
// circles, the blurred points only.

const MAP_QUERY = graphql(`
  query MapQuery($bbox: BoundingBoxInput!, $filter: ListingFilter, $zoom: Int) {
    mapListings(bbox: $bbox, filter: $filter, zoom: $zoom) {
      truncated
      markers { id categoryKey documentType point { latitude longitude } }
      clusters { count point { latitude longitude } bounds { south west north east } }
      circles { id categoryKey documentType radiusM center { latitude longitude } }
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const bbox = { south: 3.9, west: 9.6, north: 4.2, east: 9.9 };
const at = (latitude: number, longitude: number) => ({
  ...foundContent().place,
  point: { latitude, longitude },
});
const map = (variables: { filter?: object; zoom?: number } = {}) =>
  kit.client().query(MAP_QUERY, { variables: { bbox, ...variables } });

describe("a visitor's map", () => {
  test("found items are blurred markers, lost ones circles, documents included", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, { place: at(4.05123, 9.70456) });
    await publishLost(me);
    await publishLost(me, { categoryKey: "DOCUMENT", documentType: "CNI" });
    const result = await map({ zoom: 22 });
    expect(result.errors).toBeUndefined();
    const data = result.data?.mapListings;
    expect(data?.markers).toEqual([
      expect.objectContaining({
        categoryKey: "WALLET_BAG",
        point: { latitude: 4.052, longitude: 9.706 },
      }),
    ]);
    expect(
      data?.circles.map((c) => [c.categoryKey, c.documentType, c.radiusM]),
    ).toEqual(
      expect.arrayContaining([
        ["PHONE", null, 500],
        ["DOCUMENT", "CNI", 500],
      ]),
    );
    const text = JSON.stringify(result);
    for (const exact of ["4.05123", "9.70456"])
      expect(text).not.toContain(exact);
  });

  test("clusters at a low zoom, with where their members lie", async () => {
    const me = await listingsAs(kit);
    for (const n of [0, 1, 2])
      await publishFound(me, { place: at(4.05 + n * 0.002, 9.7) });
    const result = await map({ zoom: 10 });
    expect(result.data?.mapListings.markers).toEqual([]);
    expect(result.data?.mapListings.clusters).toEqual([
      expect.objectContaining({
        count: 3,
        bounds: expect.objectContaining({ south: 4.05, north: 4.054 }),
      }),
    ]);
  });

  test("the filter narrows it; an empty box is refused", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, { categoryKey: "KEYS", place: at(4.05, 9.7) });
    await publishFound(me, { place: at(4.06, 9.71) });
    const keys = await map({ filter: { categoryKey: "KEYS" }, zoom: 22 });
    expect(keys.data?.mapListings.markers.map((m) => m.categoryKey)).toEqual([
      "KEYS",
    ]);
    const empty = await kit
      .client()
      .query(MAP_QUERY, { variables: { bbox: { ...bbox, south: 5 } } });
    expect(codeOf(empty)).toBe("validation.errors.invalid-input");
  });
});
