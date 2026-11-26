import { beforeEach, describe, expect, test } from "bun:test";
import { AiError } from "@softistx/ai-core";
import { isObjectType } from "graphql";
import { schema } from "@/http/schema";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { graphql } from "~/generated/graphql";
import { listingsAs } from "~/listings";
import { publishFound } from "~/search";

// The embeddings in the search (spec §4.4, §5.4): the text query is embedded on
// this machine to re-rank the text matches; a vector is never returned.

const SEARCH = graphql(`
  query SearchEmbedded($filter: ListingFilter, $orderBy: ListingOrder) {
    searchListings(filter: $filter, orderBy: $orderBy) {
      totalCount
      edges { node { id title } }
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const seed = async () => {
  const me = await listingsAs(kit);
  await publishFound(me, { title: "Téléphone noir" });
  await publishFound(me, { title: "Téléphone rouge" });
  await publishFound(me, { title: "Clés de voiture" });
  await kit.auth.background.settled();
};

const titles = async (text: string) => {
  const result = await kit.client().query(SEARCH, {
    variables: { filter: { text }, orderBy: "RELEVANCE" },
  });
  return (result.data?.searchListings.edges ?? []).map((e) => e.node.title);
};

describe("a text search with embeddings", () => {
  test("embeds the query on this machine and returns the same matches the words found", async () => {
    await seed();
    kit.ollama.adapter.calls.length = 0;
    const found = await titles("téléphone");
    expect([...found].sort()).toEqual(["Téléphone noir", "Téléphone rouge"]);
    expect(kit.ollama.adapter.calls).toEqual([["search_query: téléphone"]]);
  });

  test("a query the words do not match adds no listing", async () => {
    await seed();
    expect(await titles("parapluie")).toEqual([]);
  });

  test("with Ollama down the search still answers, by its words", async () => {
    await seed();
    kit.ollama.adapter.embed = async () => {
      throw new AiError("MODEL_ERROR", "down");
    };
    expect([...(await titles("téléphone"))].sort()).toEqual([
      "Téléphone noir",
      "Téléphone rouge",
    ]);
  });
});

describe("what the schema exposes", () => {
  test("no type has a field for an embedding or a vector", () => {
    const names = Object.values(schema.getTypeMap())
      .filter(isObjectType)
      .flatMap((type) =>
        Object.keys(type.getFields()).map((field) => `${type.name}.${field}`),
      )
      .filter((name) => /embedding|vector/i.test(name));
    expect(names).toEqual([]);
  });
});
