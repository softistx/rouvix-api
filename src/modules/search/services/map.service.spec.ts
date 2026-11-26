import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { foundContent, listingsAs, lostContent } from "~/listings";
import { refusal } from "~/refusals";
import { publishFound, publishLost } from "~/search";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const around = { south: 3.9, west: 9.6, north: 4.2, east: 9.9 };
const place = (lat: number, lon: number, over = {}) => ({
  ...foundContent().place,
  point: { latitude: lat, longitude: lon },
  ...over,
});

describe("found listings", () => {
  test("a private finder's point is the blurred cell, never the exact digits", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, { place: place(4.05123, 9.70456) });
    const map = await me.services.map.map(around, {}, 22);
    expect(map.markers).toHaveLength(1);
    expect(map.markers[0]?.point).toEqual({
      latitude: 4.052,
      longitude: 9.706,
    });
    expect(JSON.stringify(map)).not.toContain("4.05123");
    expect(JSON.stringify(map)).not.toContain("9.70456");
  });

  test("an item kept at a police station is shown where it is", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, {
      place: place(4.05123, 9.70456, { keptAt: "AT_POLICE" }),
    });
    const map = await me.services.map.map(around, {}, 22);
    expect(map.markers[0]?.point).toEqual({
      latitude: 4.05123,
      longitude: 9.70456,
    });
  });

  test("only what is inside the box", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, { place: place(4.05, 9.7) });
    await publishFound(me, { place: place(5.5, 9.7) });
    const map = await me.services.map.map(around, {}, 22);
    expect(map.markers).toHaveLength(1);
  });

  test("close listings cluster at a low zoom and split at a high one", async () => {
    const me = await listingsAs(kit);
    for (let n = 0; n < 4; n++) {
      await publishFound(me, { place: place(4.05 + n * 0.002, 9.7) });
    }
    const low = await me.services.map.map(around, {}, 10);
    expect(low.markers).toEqual([]);
    expect(low.clusters.map((c) => c.count)).toEqual([4]);
    const high = await me.services.map.map(around, {}, 22);
    expect(high.markers).toHaveLength(4);
    expect(high.clusters).toEqual([]);
    expect(high.truncated).toBe(false);
  });

  test("the filter narrows the map as it narrows the search", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, {
      categoryKey: "KEYS",
      title: "Clés trouvées",
      place: place(4.05, 9.7),
    });
    await publishFound(me, { title: "Portefeuille", place: place(4.06, 9.71) });
    const map = await me.services.map.map(around, { categoryKey: "KEYS" }, 22);
    expect(map.markers.map((m) => m.categoryKey)).toEqual(["KEYS"]);
    const text = await me.services.map.map(
      around,
      { text: "portefeuille" },
      22,
    );
    expect(text.markers).toHaveLength(1);
  });
});

describe("lost listings", () => {
  test("a circle at the blurred centre with its radius, no marker", async () => {
    const me = await listingsAs(kit);
    await publishLost(me);
    const map = await me.services.map.map(around, {}, 22);
    expect(map.markers).toEqual([]);
    expect(map.circles).toEqual([
      expect.objectContaining({
        radiusM: 500,
        center: { latitude: 4.052, longitude: 9.706 },
      }),
    ]);
    expect(JSON.stringify(map)).not.toContain("4.05123");
  });

  test("a circle whose centre is outside the box but reaches in is drawn; one that does not is not", async () => {
    const me = await listingsAs(kit);
    // 1.1 km west of the box's west edge: 2 km reaches, 500 m does not.
    const lonOut = around.west - 0.01;
    await publishLost(me, {
      title: "Atteint",
      place: {
        ...lostContent().place,
        point: { latitude: 4, longitude: lonOut },
        radiusM: 2_000,
      },
    });
    await publishLost(me, {
      title: "Loin",
      place: {
        ...lostContent().place,
        point: { latitude: 4, longitude: lonOut },
        radiusM: 500,
      },
    });
    const map = await me.services.map.map(around, {}, 22);
    expect(map.circles.map((c) => c.radiusM)).toEqual([2_000]);
  });

  test("a kind filter leaves out the other side", async () => {
    const me = await listingsAs(kit);
    await publishLost(me);
    await publishFound(me, { place: place(4.05, 9.7) });
    const lost = await me.services.map.map(around, { kind: "LOST" }, 22);
    expect([lost.markers.length, lost.circles.length]).toEqual([0, 1]);
    const found = await me.services.map.map(around, { kind: "FOUND" }, 22);
    expect([found.markers.length, found.circles.length]).toEqual([1, 0]);
  });
});

describe("limits", () => {
  test("an empty box is one invalid input", async () => {
    const me = await listingsAs(kit);
    const error = await refusal(
      me.services.map.map({ ...around, south: 5 }, {}, 5),
    );
    expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
  });

  test("markers and clusters together never pass 500, whatever the zoom asked", async () => {
    const me = await listingsAs(kit);
    const first = await publishFound(me);
    // 700 copies spread over the box, written as stored (a spec of the map's
    // size, not of the declaration).
    const { _id, ...stored } = (await mongo.db.listings.raw.findOne({
      _id: first._id,
    })) as NonNullable<unknown> & { _id: unknown };
    const copies = Array.from({ length: 700 }, (_, n) => ({
      ...stored,
      _id: new ObjectId(),
      geo: {
        type: "Point" as const,
        coordinates: [
          9.65 + Math.floor(n / 28) * 0.009,
          3.95 + (n % 28) * 0.009,
        ],
      },
    }));
    await mongo.db.listings.raw.insertMany(copies as never);
    const map = await me.services.map.map(around, {}, 22);
    expect(map.markers.length + map.clusters.length).toBeLessThanOrEqual(500);
    const counted =
      map.markers.length + map.clusters.reduce((sum, c) => sum + c.count, 0);
    // The original is in Yaoundé, outside the box: the 700 copies are on it.
    expect(counted).toBe(700);
    expect(_id).toBeDefined();
  });
});
