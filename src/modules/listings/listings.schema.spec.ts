import { describe, expect, test } from "bun:test";
import {
  type GraphQLNamedType,
  type GraphQLObjectType,
  getNamedType,
  isObjectType,
} from "graphql";
import { schema } from "@/http/schema";

// The leak spec of the listings (spec §8, AGENTS.md "Masked by default"): what
// a visitor can reach from `Query.listing` is fixed here, so a field added to
// the public view, or a type it comes to reach, fails until it is reviewed.

const reachable = (root: string) => {
  const seen = new Map<string, GraphQLObjectType>();
  const walk = (type: GraphQLNamedType) => {
    if (!isObjectType(type) || seen.has(type.name)) return;
    seen.set(type.name, type);
    for (const field of Object.values(type.getFields()))
      walk(getNamedType(field.type));
  };
  walk(schema.getType(root) as GraphQLNamedType);
  return seen;
};

describe("what a visitor reaches from a listing", () => {
  test("PublicListing has exactly the masked fields", () => {
    const type = schema.getType("PublicListing") as GraphQLObjectType;
    expect(Object.keys(type.getFields()).sort()).toEqual([
      "attributes",
      "blurredPhotoKeys",
      "categoryKey",
      "countryCode",
      "date",
      "description",
      "documentType",
      "expiresAt",
      "holderHint",
      "id",
      "kind",
      "maskedNumber",
      "organisationSlug",
      "photoKeys",
      "place",
      "publishedAt",
      "status",
      "title",
    ]);
  });

  test("it reaches only the place, the attributes and a point: no author, question or photo status", () => {
    expect([...reachable("PublicListing").keys()].sort()).toEqual([
      "GeoPoint",
      "ListingAttributes",
      "PublicListing",
      "PublicPlace",
    ]);
  });

  test("a photo is a media key, never a URL, on the public view and the author's", () => {
    const urls = [
      ...reachable("Listing").values(),
      ...reachable("PublicListing").values(),
    ].flatMap((type) =>
      Object.keys(type.getFields()).filter((name) =>
        /url|href|presign|original/i.test(name),
      ),
    );
    expect(urls).toEqual([]);
  });

  test("the author's view is reachable through the author's queries and mutations only", () => {
    const returning = (target: string) =>
      [schema.getQueryType(), schema.getMutationType()].flatMap((root) =>
        Object.values(root?.getFields() ?? {})
          .filter(
            (field) =>
              getNamedType(field.type).name === target ||
              getNamedType(field.type).name === `${target}Connection`,
          )
          .map((field) => field.name),
      );
    expect(returning("Listing").sort()).toEqual([
      "closeListing",
      "declareListing",
      "extendListing",
      "myListing",
      "myListings",
      "updateListing",
    ]);
    expect(returning("PublicListing").sort()).toEqual([
      "listing",
      "searchListings",
    ]);
  });

  test("no listing type holds an account id, a phone, a tenant or a storage field", () => {
    const banned =
      /^(authorId|orgId|phone|phoneMasked|accountId|organisationId|bucket|objectKey|embedding|idFields|idNumberHash)$/;
    const found = [
      ...reachable("Listing").values(),
      ...reachable("PublicListing").values(),
    ].flatMap((type) =>
      Object.keys(type.getFields())
        .filter((name) => banned.test(name))
        .map((name) => `${type.name}.${name}`),
    );
    expect(found).toEqual([]);
  });

  test("no type of the whole schema carries what the OCR read of an ID document", () => {
    const banned =
      /^(idFields|idNumberHash|idNumber|fullNumber|lastDigits|last4|surname|givenNames|holderName|birthDate|expiryDate|mrz)$/i;
    const found = Object.values(schema.getTypeMap())
      .filter((type) => isObjectType(type) && !type.name.startsWith("__"))
      .flatMap((type) =>
        Object.keys((type as GraphQLObjectType).getFields())
          .filter((name) => banned.test(name))
          .map((name) => `${type.name}.${name}`),
      );
    expect(found).toEqual([]);
  });
});
