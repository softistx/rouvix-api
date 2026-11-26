import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { foundContent, listingsAs, lostContent } from "~/listings";
import { refusal } from "~/refusals";
import { daysAgo, douala, publishFound, publishLost } from "~/search";
import { textRanker } from "../search.ranking";
import { encodeCursor, MAX_DEPTH } from "../search.utils";
import { SearchService } from "./search.service";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const titles = async (
  me: Awaited<ReturnType<typeof listingsAs>>,
  filter: Parameters<typeof me.services.search.search>[0],
  order: Parameters<typeof me.services.search.search>[2] = "DATE",
) =>
  (
    await me.services.search.search(filter, { first: 50, after: null }, order)
  ).edges.map((edge) => edge.node.title);

describe("what is searched", () => {
  test("only open listings, and none past their expiry", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, { title: "Ouvert ouvert" });
    await me.listings.declare(
      me.viewer,
      { ...foundContent({ title: "Brouillon brouillon" }), kind: "FOUND" },
      null,
    );
    const closed = await publishFound(me, { title: "Fermé fermé" });
    await me.listings.close(me.viewer, closed._id.toHexString(), "OTHER");
    const removed = await publishFound(me, { title: "Retiré retiré" });
    await me.listings.remove(me.viewer, removed._id.toHexString());
    expect(await titles(me, {})).toEqual(["Ouvert ouvert"]);
    // Past its 90 days the listing is not searched, whatever its status says.
    const later = new SearchService(mongo, {
      now: () => new Date(Date.now() + 91 * 86_400_000),
      ranker: textRanker,
    });
    const page = await later.search({}, { first: 5, after: null }, "DATE");
    expect(page.edges).toEqual([]);
  });

  test("text: case and accents ignored, french and english alike, no stemming", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, { title: "Écharpe rouge", description: "Soie" });
    await publishFound(me, {
      title: "Red scarf",
      description: "Silk, left on a bench",
    });
    expect(await titles(me, { text: "echarpe" })).toEqual(["Écharpe rouge"]);
    expect(await titles(me, { text: "ROUGE" })).toEqual(["Écharpe rouge"]);
    expect(await titles(me, { text: "scarf" })).toEqual(["Red scarf"]);
    expect(await titles(me, { text: "scarves" })).toEqual([]);
    expect(await titles(me, { text: "bench" })).toEqual(["Red scarf"]);
  });

  test("text reaches the brand, the marks and the colours, never the place label", async () => {
    const me = await listingsAs(kit);
    await publishLost(me, {
      title: "Un sac",
      attributes: {
        colours: ["turquoise"],
        brand: "Marque-Z",
        marks: "cicatrice",
      },
      place: { ...lostContent().place, label: "Rue du Faux Nom" },
    });
    expect(await titles(me, { text: "turquoise" })).toEqual(["Un sac"]);
    expect(await titles(me, { text: "cicatrice" })).toEqual(["Un sac"]);
    expect(await titles(me, { text: "Marque" })).toEqual(["Un sac"]);
    expect(await titles(me, { text: "Faux" })).toEqual([]);
  });

  test("an ID document is found by its type, never by its text", async () => {
    const me = await listingsAs(kit);
    await publishLost(me, {
      categoryKey: "DOCUMENT",
      documentType: "CNI",
      title: "CNI de Personne Imaginaire",
      description: "Numéro 000000000",
    });
    expect(await titles(me, { text: "Imaginaire" })).toEqual([]);
    expect(await titles(me, { text: "000000000" })).toEqual([]);
    expect((await titles(me, { text: "CNI" })).length).toBe(1);
    expect((await titles(me, { documentType: "CNI" })).length).toBe(1);
  });

  test("kind, category, document type, city and days", async () => {
    const me = await listingsAs(kit);
    await publishLost(me, { title: "Téléphone", date: daysAgo(10) });
    await publishFound(me, {
      title: "Portefeuille",
      date: daysAgo(3),
      place: { ...foundContent().place, city: "Yaoundé" },
    });
    await publishFound(me, {
      title: "Clés",
      categoryKey: "KEYS",
      date: daysAgo(1),
      place: { ...foundContent().place, city: "  YAOUNDE " },
    });
    expect(await titles(me, { kind: "LOST" })).toEqual(["Téléphone"]);
    expect(await titles(me, { kind: "FOUND" })).toEqual([
      "Clés",
      "Portefeuille",
    ]);
    expect(await titles(me, { categoryKey: "KEYS" })).toEqual(["Clés"]);
    expect(await titles(me, { city: "yaoundé" })).toEqual([
      "Clés",
      "Portefeuille",
    ]);
    expect(await titles(me, { city: "Douala" })).toEqual([]);
    expect(await titles(me, { dateFrom: daysAgo(3) })).toEqual([
      "Clés",
      "Portefeuille",
    ]);
    expect(await titles(me, { dateTo: daysAgo(3) })).toEqual([
      "Portefeuille",
      "Téléphone",
    ]);
    expect(
      await titles(me, { dateFrom: daysAgo(5), dateTo: daysAgo(2) }),
    ).toEqual(["Portefeuille"]);
  });

  test("a day range the wrong way round is one invalid input", async () => {
    const me = await listingsAs(kit);
    const error = await refusal(
      me.services.search.search(
        { dateFrom: daysAgo(1), dateTo: daysAgo(5) },
        { first: 5, after: null },
        "DATE",
      ),
    );
    expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
  });
});

describe("around me", () => {
  test("by distance from the blurred point, nearest first, with the distance", async () => {
    const me = await listingsAs(kit);
    const at = (dLat: number) => ({
      ...lostContent().place,
      point: douala(dLat, 0),
    });
    await publishLost(me, { title: "Loin", place: at(0.05) });
    await publishLost(me, { title: "Près", place: at(0.002) });
    await publishLost(me, { title: "Très loin", place: at(1) });
    const near = { point: douala(), radiusM: 10_000 };
    const page = await me.services.search.search(
      { near },
      { first: 10, after: null },
      "DISTANCE",
    );
    expect(page.edges.map((e) => e.node.title)).toEqual(["Près", "Loin"]);
    const [first, second] = page.edges.map((e) => e.distanceM ?? 0);
    expect(first).toBeLessThan(500);
    expect(second).toBeGreaterThan(5_000);
    expect(second).toBeLessThan(6_000);
  });

  test("a private point cannot be located finer than its snapped cell", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, {
      place: {
        ...foundContent().place,
        point: { latitude: 3.84812, longitude: 11.50234 },
      },
    });
    // The exact point is 3.84812, 11.50234; its public cell is 3.848, 11.502.
    // A 100 m circle on the exact point and one on the cell both find it, one
    // 500 m away does not: the filter answers for the cell, not the point.
    const found = (lat: number, lon: number, radiusM: number) =>
      titles(me, {
        near: { point: { latitude: lat, longitude: lon }, radiusM },
      });
    expect((await found(3.848, 11.502, 100)).length).toBe(1);
    expect((await found(3.8527, 11.502, 100)).length).toBe(0);
  });
});

describe("pages and counts", () => {
  test("a cursor connection in newest-day order, with its total", async () => {
    const me = await listingsAs(kit);
    for (const n of [1, 2, 3, 4, 5]) {
      await publishFound(me, { title: `Objet ${n}`, date: daysAgo(n) });
    }
    const one = await me.services.search.search(
      {},
      { first: 2, after: null },
      "DATE",
    );
    expect(one.edges.map((e) => e.node.title)).toEqual(["Objet 1", "Objet 2"]);
    expect(one.totalCount).toBe(5);
    expect(one.pageInfo).toMatchObject({
      hasNextPage: true,
      hasPreviousPage: false,
    });
    const two = await me.services.search.search(
      {},
      { first: 2, after: one.pageInfo.endCursor },
      "DATE",
    );
    expect(two.edges.map((e) => e.node.title)).toEqual(["Objet 3", "Objet 4"]);
    const three = await me.services.search.search(
      {},
      { first: 2, after: two.pageInfo.endCursor },
      "DATE",
    );
    expect(three.edges.map((e) => e.node.title)).toEqual(["Objet 5"]);
    expect(three.pageInfo.hasNextPage).toBe(false);
  });

  test("a cursor nobody gave is invalid input", async () => {
    const me = await listingsAs(kit);
    for (const after of [
      "nope",
      Buffer.from('{"o":-1}').toString("base64url"),
    ]) {
      const error = await refusal(
        me.services.search.search({}, { first: 5, after }, "DATE"),
      );
      expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
    }
  });

  test("a cursor past the cap gives an empty last page", async () => {
    const me = await listingsAs(kit);
    await publishFound(me);
    const page = await me.services.search.search(
      {},
      { first: 20, after: encodeCursor(MAX_DEPTH) },
      "DATE",
    );
    expect(page.edges).toEqual([]);
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.totalCount).toBe(1);
  });

  test("relevance orders by the text score, through the ranking port", async () => {
    const me = await listingsAs(kit);
    await publishFound(me, {
      title: "Clé",
      description: "clé clé clé de voiture",
    });
    await publishFound(me, { title: "Autre", description: "une clé" });
    expect(await titles(me, { text: "clé" }, "RELEVANCE")).toEqual([
      "Clé",
      "Autre",
    ]);
    const reversing = {
      rank: async (
        _: unknown,
        c: readonly { id: unknown; textScore: number }[],
      ) => [...c].reverse() as never,
    };
    const service = new SearchService(mongo, {
      now: () => new Date(kit.clock.now()),
      ranker: reversing,
    });
    const page = await service.search(
      { text: "clé" },
      { first: 5, after: null },
      "RELEVANCE",
    );
    expect(page.edges.map((e) => e.node.title)).toEqual(["Autre", "Clé"]);
  });

  test("counts per kind and per category, each without its own filter", async () => {
    const me = await listingsAs(kit);
    await publishLost(me, { categoryKey: "PHONE" });
    await publishLost(me, { categoryKey: "PHONE" });
    await publishFound(me, { categoryKey: "KEYS" });
    await publishFound(me, { categoryKey: "PHONE" });
    const counts = await me.services.search.counts({
      kind: "FOUND",
      categoryKey: "KEYS",
    });
    expect(counts.kinds).toEqual([{ kind: "FOUND", count: 1 }]);
    expect(counts.categories).toEqual([
      { categoryKey: "KEYS", count: 1 },
      { categoryKey: "PHONE", count: 1 },
    ]);
  });
});
