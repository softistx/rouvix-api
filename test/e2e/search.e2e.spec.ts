import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { foundContent, listingsAs, lostContent } from "~/listings";
import { daysAgo, publishFound, publishLost } from "~/search";

// Search as a visitor (no session) and as a signed-in account, over the
// request's own context: every filter, the order, the counts, the cap.

const SEARCH_QUERY = graphql(`
  query SearchQuery($filter: ListingFilter, $first: Int, $after: String, $orderBy: ListingOrder) {
    searchListings(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
      totalCount
      pageInfo { hasNextPage endCursor }
      counts {
        kinds { kind count }
        categories { categoryKey count }
      }
      edges {
        distanceM
        node {
          id kind categoryKey documentType title date status
          place { label city keptAt radiusM point { latitude longitude } }
        }
      }
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const search = (
  variables: typeof SEARCH_QUERY extends { __apiType?: (v: infer V) => unknown }
    ? V
    : never,
  token?: string,
) => kit.client(token).query(SEARCH_QUERY, { variables });

const seed = async () => {
  const me = await listingsAs(kit);
  await publishLost(me, { title: "Téléphone noir", date: daysAgo(6) });
  await publishFound(me, {
    title: "Portefeuille brun",
    date: daysAgo(2),
    place: { ...foundContent().place, city: "Yaoundé" },
  });
  await publishFound(me, {
    title: "Clés de voiture",
    categoryKey: "KEYS",
    date: daysAgo(1),
    place: { ...foundContent().place, city: "Douala" },
  });
  await publishLost(me, {
    categoryKey: "DOCUMENT",
    documentType: "CNI",
    title: "CNI de Personne Imaginaire",
    description: "Numéro 000000000",
  });
  return me;
};

describe("a visitor searches", () => {
  test("no session, no filter: every open listing, the newest day first, masked", async () => {
    await seed();
    const result = await search({ first: 10 });
    expect(result.errors).toBeUndefined();
    const page = result.data?.searchListings;
    expect(page?.totalCount).toBe(4);
    expect(page?.edges.map((e) => e.node.title)).toEqual([
      null,
      "Clés de voiture",
      "Portefeuille brun",
      "Téléphone noir",
    ]);
    expect(page?.edges.every((e) => e.distanceM === null)).toBe(true);
    expect(page?.pageInfo.hasNextPage).toBe(false);
  });

  test("text, kind, category, document type, city and days", async () => {
    await seed();
    const titles = async (filter: object) =>
      (await search({ first: 10, filter })).data?.searchListings.edges.map(
        (e) => e.node.title,
      );
    expect(await titles({ text: "portefeuille" })).toEqual([
      "Portefeuille brun",
    ]);
    expect(await titles({ text: "imaginaire" })).toEqual([]);
    expect(await titles({ kind: "LOST" })).toEqual([null, "Téléphone noir"]);
    expect(await titles({ categoryKey: "KEYS" })).toEqual(["Clés de voiture"]);
    expect(await titles({ documentType: "CNI" })).toEqual([null]);
    expect(await titles({ city: "douala" })).toEqual(["Clés de voiture"]);
    expect(await titles({ dateFrom: daysAgo(2), dateTo: daysAgo(1) })).toEqual([
      "Clés de voiture",
      "Portefeuille brun",
    ]);
  });

  test("around me: nearest first, with the distance in metres", async () => {
    const me = await listingsAs(kit);
    const lost = (title: string, dLat: number) =>
      publishLost(me, {
        title,
        place: {
          ...lostContent().place,
          point: { latitude: 4.05 + dLat, longitude: 9.7 },
        },
      });
    await lost("A 4 km", 0.036);
    await lost("A 1 km", 0.009);
    await lost("Trop loin", 0.5);
    const result = await search({
      first: 10,
      orderBy: "DISTANCE",
      filter: {
        near: { point: { latitude: 4.05, longitude: 9.7 }, radiusM: 10_000 },
      },
    });
    const edges = result.data?.searchListings.edges ?? [];
    expect(edges.map((e) => e.node.title)).toEqual(["A 1 km", "A 4 km"]);
    expect(edges[0]?.distanceM).toBeGreaterThan(900);
    expect(edges[0]?.distanceM).toBeLessThan(1_200);
    expect(edges[1]?.distanceM).toBeGreaterThan(3_800);
  });

  test("the counts of the chips, and the pages with their cursor", async () => {
    await seed();
    const first = await search({ first: 2, filter: { kind: "FOUND" } });
    const page = first.data?.searchListings;
    expect(page?.counts.kinds).toEqual(
      expect.arrayContaining([
        { kind: "FOUND", count: 2 },
        { kind: "LOST", count: 2 },
      ]),
    );
    expect(
      page?.counts.categories.find((c) => c.categoryKey === "KEYS")?.count,
    ).toBe(1);
    expect(page?.totalCount).toBe(2);
    const next = await search({ first: 1, filter: { kind: "FOUND" } });
    expect(next.data?.searchListings.pageInfo.hasNextPage).toBe(true);
    const after = next.data?.searchListings.pageInfo.endCursor;
    const second = await search({ first: 1, after, filter: { kind: "FOUND" } });
    expect(second.data?.searchListings.edges.map((e) => e.node.title)).toEqual([
      "Portefeuille brun",
    ]);
  });

  test("a page asks for 50 at most; a bad cursor and reversed days are refused", async () => {
    const tooMany = await search({ first: 51 });
    expect(tooMany.errors).toBeDefined();
    expect(codeOf(await search({ first: 5, after: "nope" }))).toBe(
      "validation.errors.invalid-input",
    );
    expect(
      codeOf(
        await search({
          first: 5,
          filter: { dateFrom: daysAgo(1), dateTo: daysAgo(3) },
        }),
      ),
    ).toBe("validation.errors.invalid-input");
  });

  test("a signed-in account gets the same masked view, its own listings included", async () => {
    const me = await signedIn(kit, { phone: "+237600000007" });
    const own = await listingsAs(kit, 7);
    await publishFound(own, { title: "Mon objet" });
    const result = await search({ first: 5 }, me.token);
    expect(result.errors).toBeUndefined();
    expect(result.data?.searchListings.edges.map((e) => e.node.title)).toEqual([
      "Mon objet",
    ]);
  });
});
