import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { foundContent, listingsAs, lostContent } from "~/listings";
import { refusal } from "~/refusals";
import { daysAgo, douala, publishFound, publishLost } from "~/search";
import { textRanker } from "../search.ranking";
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
