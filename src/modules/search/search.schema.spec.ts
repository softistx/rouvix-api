import { describe, expect, test } from "bun:test";
import {
  type GraphQLNamedType,
  type GraphQLObjectType,
  getNamedType,
  isInputObjectType,
  isObjectType,
} from "graphql";
import { schema } from "@/http/schema";

// The leak spec of search (spec §8, AGENTS.md "Masked by default"): what a
// visitor can reach from `searchListings` and `mapListings`, and what a filter
// may name, is fixed here, so a field added to either fails until reviewed.

const reachable = (operation: string) => {
  const seen = new Map<string, GraphQLObjectType>();
  const walk = (type: GraphQLNamedType) => {
    if (!isObjectType(type) || seen.has(type.name)) return;
    seen.set(type.name, type);
    for (const field of Object.values(type.getFields()))
      walk(getNamedType(field.type));
  };
  const field = schema.getQueryType()?.getFields()[operation];
  walk(getNamedType((field as NonNullable<typeof field>).type));
  return seen;
};

const fieldsOf = (name: string) => {
  const type = schema.getType(name);
  return Object.keys(
    (isObjectType(type) || isInputObjectType(type)
      ? type.getFields()
      : {}) as object,
  ).sort();
};

describe("what a visitor reaches from the search", () => {
  test("a result is the masked listing: the same types as `listing`, plus the edge and the counts", () => {
    expect([...reachable("searchListings").keys()].sort()).toEqual([
      "GeoPoint",
      "ListingAttributes",
      "ListingCategoryCount",
      "ListingCounts",
      "ListingKindCount",
      "PageInfo",
      "PublicListing",
      "PublicListingConnection",
      "PublicListingEdge",
      "PublicPlace",
    ]);
    expect(fieldsOf("PublicListingEdge")).toEqual(["distanceM", "node"]);
    expect(fieldsOf("PublicListingConnection")).toEqual([
      "counts",
      "edges",
      "pageInfo",
      "totalCount",
    ]);
    expect(fieldsOf("PublicPlace")).toEqual([
      "city",
      "keptAt",
      "label",
      "point",
      "radiusM",
    ]);
  });

  test("the map reaches points and circles, with no listing text, author or exact radius field", () => {
    expect([...reachable("mapListings").keys()].sort()).toEqual([
      "BoundingBox",
      "GeoPoint",
      "ListingMap",
      "MapCircle",
      "MapCluster",
      "MapMarker",
    ]);
    expect(fieldsOf("ListingMap")).toEqual([
      "circles",
      "clusters",
      "markers",
      "truncated",
    ]);
    expect(fieldsOf("MapMarker")).toEqual([
      "categoryKey",
      "documentType",
      "id",
      "point",
    ]);
    expect(fieldsOf("MapCircle")).toEqual([
      "categoryKey",
      "center",
      "documentType",
      "id",
      "radiusM",
    ]);
    expect(fieldsOf("MapCluster")).toEqual(["bounds", "count", "point"]);
  });

  test("a filter names only what the masked view shows", () => {
    expect(fieldsOf("ListingFilter")).toEqual([
      "categoryKey",
      "city",
      "dateFrom",
      "dateTo",
      "documentType",
      "kind",
      "near",
      "text",
    ]);
    expect(fieldsOf("ListingNearInput")).toEqual(["point", "radiusM"]);
  });

  test("nothing of search holds an account id, a phone, a tenant, a storage or an author field", () => {
    const banned =
      /^(authorId|orgId|phone|accountId|organisationId|bucket|objectKey|embedding|idFields|idNumberHash|searchText|cityKey|geo|questions|answer)$/;
    const found = [
      ...reachable("searchListings").values(),
      ...reachable("mapListings").values(),
    ].flatMap((type) =>
      Object.keys(type.getFields())
        .filter((name) => banned.test(name))
        .map((name) => `${type.name}.${name}`),
    );
    expect(found).toEqual([]);
  });

  test("the operations are public: they take no session argument and are on Query only", () => {
    const query = Object.keys(schema.getQueryType()?.getFields() ?? {});
    expect(query).toEqual(
      expect.arrayContaining(["searchListings", "mapListings"]),
    );
    const mutation = Object.keys(schema.getMutationType()?.getFields() ?? {});
    expect(mutation.filter((name) => /search|map/i.test(name))).toEqual([]);
  });
});
