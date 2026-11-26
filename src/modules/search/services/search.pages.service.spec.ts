import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { listingsAs } from "~/listings";
import { refusal } from "~/refusals";
import { daysAgo, publishFound, publishLost } from "~/search";
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

  test("a cursor beyond the cap is not a cursor", async () => {
    const me = await listingsAs(kit);
    for (const o of [MAX_DEPTH + 1, 2 ** 60]) {
      const error = await refusal(
        me.services.search.search(
          {},
          { first: 5, after: encodeCursor(o) },
          "DATE",
        ),
      );
      expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
    }
  });

  test("a cursor at the cap gives an empty last page", async () => {
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
