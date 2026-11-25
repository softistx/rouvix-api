import { describe, expect, test } from "bun:test";
import {
  type GraphQLNamedType,
  type GraphQLObjectType,
  getNamedType,
  isInputObjectType,
  isObjectType,
} from "graphql";
import { schema } from "@/http/schema";

// The leak spec of spec §8: no resolver returns a phone number to anyone but
// its holder, and the schema is where that is decided. The one field that
// carries a whole number is `Account.phone`; `Account` is reachable through
// `Viewer.account` only, and `Viewer` through `Query.viewer` only, so a number
// is always the signed-in account's own.

const typeMap = schema.getTypeMap();
const objectTypes = Object.values(typeMap).filter(
  (type): type is GraphQLObjectType =>
    isObjectType(type) && !type.name.startsWith("__"),
);

// Every (type, field) whose named type is `target`.
const fieldsReturning = (target: GraphQLNamedType) =>
  objectTypes.flatMap((type) =>
    Object.values(type.getFields())
      .filter((field) => getNamedType(field.type) === target)
      .map((field) => `${type.name}.${field.name}`),
  );

describe("phone numbers in the schema", () => {
  test("the only field called phone is Account.phone", () => {
    const phones = objectTypes.flatMap((type) =>
      Object.keys(type.getFields())
        .filter((name) => /phone/i.test(name))
        .map((name) => `${type.name}.${name}`),
    );
    expect(phones.sort()).toEqual(["Account.phone", "Member.phoneMasked"]);
  });

  test("an input asks for a phone only to invite one, on `inviteMember`", () => {
    const inputs = Object.values(typeMap)
      .filter(isInputObjectType)
      .flatMap((type) =>
        Object.keys(type.getFields()).filter((name) => /phone/i.test(name)),
      );
    expect(inputs).toEqual([]);
    const invite = (schema.getMutationType() as GraphQLObjectType).getFields()[
      "inviteMember"
    ];
    expect(invite?.args.map((arg) => arg.name)).toContain("phone");
  });

  test("Account is reachable through Viewer.account only", () => {
    expect(fieldsReturning(typeMap["Account"] as GraphQLNamedType)).toEqual([
      "Viewer.account",
    ]);
  });

  test("Viewer is reachable through Query.viewer only", () => {
    expect(fieldsReturning(typeMap["Viewer"] as GraphQLNamedType)).toEqual([
      "Query.viewer",
    ]);
  });

  test("a member exposes its phone masked, never whole, and no account id", () => {
    const member = schema.getType("Member") as GraphQLObjectType;
    expect(Object.keys(member.getFields()).sort()).toEqual([
      "createdAt",
      "id",
      "phoneMasked",
      "role",
      "status",
    ]);
  });

  test("no type exposes a sensitive internal: tenant id, token hash, account links", () => {
    const banned = /^(organisationId|tokenHash|deletedAt|accountId|invitedBy)$/;
    const found = objectTypes.flatMap((type) =>
      Object.keys(type.getFields())
        .filter((name) => banned.test(name))
        .map((name) => `${type.name}.${name}`),
    );
    expect(found).toEqual([]);
  });
});
