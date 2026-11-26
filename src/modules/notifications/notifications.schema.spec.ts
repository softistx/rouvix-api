import { describe, expect, test } from "bun:test";
import {
  type GraphQLNamedType,
  type GraphQLObjectType,
  getNamedType,
  isObjectType,
} from "graphql";
import { schema } from "@/http/schema";

// The leak spec of the notifications (spec §5.6 and §8): what a notice, the
// settings and an account's address can show, read from the schema. No phone
// number, no ID data, no item detail in a notice; no push endpoint or key ever
// returned; the e-mail address is the holder's own.

const typeMap = schema.getTypeMap();
const objectTypes = Object.values(typeMap).filter(
  (type): type is GraphQLObjectType =>
    isObjectType(type) && !type.name.startsWith("__"),
);
const fieldsOf = (name: string) =>
  Object.keys((typeMap[name] as GraphQLObjectType).getFields()).sort();
const fieldsReturning = (target: GraphQLNamedType) =>
  objectTypes.flatMap((type) =>
    Object.values(type.getFields())
      .filter((field) => getNamedType(field.type) === target)
      .map((field) => `${type.name}.${field.name}`),
  );

describe("notifications in the schema", () => {
  test("a notice names its kind and its listing, and nothing of the item", () => {
    expect(fieldsOf("Notification")).toEqual([
      "createdAt",
      "id",
      "kind",
      "listingId",
      "readAt",
    ]);
  });

  test("a notice is reachable through the account's own connection and markRead only", () => {
    expect(
      fieldsReturning(typeMap["Notification"] as GraphQLNamedType),
    ).toEqual(["Mutation.markRead", "NotificationEdge.node"]);
    expect(
      fieldsReturning(typeMap["NotificationConnection"] as GraphQLNamedType),
    ).toEqual(["Query.notifications"]);
  });

  test("the settings are the account's own, through Viewer and updateSettings only", () => {
    expect(fieldsOf("Settings")).toEqual([
      "emailCopies",
      "locale",
      "notifyClaim",
      "notifyMatch",
      "notifyMessage",
      "pushPreviews",
    ]);
    expect(fieldsReturning(typeMap["Settings"] as GraphQLNamedType)).toEqual([
      "Viewer.settings",
      "Mutation.updateSettings",
    ]);
  });

  test("no type returns a push endpoint or key: a subscription is input only", () => {
    const names = objectTypes.flatMap((type) =>
      Object.keys(type.getFields()).filter((name) =>
        /endpoint|p256dh|vapid|subscription/i.test(name),
      ),
    );
    expect(names).toEqual([]);
    const mutation = schema.getMutationType() as GraphQLObjectType;
    const subscribe = mutation.getFields()["subscribePush"];
    expect(String(subscribe?.type)).toBe("Boolean!");
  });

  test("the only field called email is Account.email, the holder's own", () => {
    const emails = objectTypes.flatMap((type) =>
      Object.keys(type.getFields())
        .filter((name) => /mail/i.test(name) && name !== "emailCopies")
        .map((name) => `${type.name}.${name}`),
    );
    expect(emails.sort()).toEqual(["Account.email", "Account.emailVerified"]);
  });
});
