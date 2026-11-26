import { beforeEach, describe, expect, test } from "bun:test";
import { isTenantOwned } from "@softistx/mongo";
import { ObjectId } from "mongodb";
import { mongo } from "@/config/db";
import * as collections from "@/modules/collections";
import { clearDatabase } from "~/db";
import { fakeE164 } from "~/fixtures";
import { scoped } from "./organisation-scope";

beforeEach(clearDatabase);

const member = (phone: string) => ({
  phone,
  accountId: null,
  role: "AGENT" as const,
  status: "INVITED" as const,
  tokenHash: null,
  expiresAt: null,
  invitedBy: "01933333-3333-7333-8333-333333333333",
});

describe("scoped members", () => {
  test("no read or write crosses organisations", async () => {
    const [a, b] = [new ObjectId(), new ObjectId()];
    const inA = scoped(mongo.db.members, a);
    const inB = scoped(mongo.db.members, b);
    const mine = await inA.create(member(fakeE164(1)));
    const theirs = await inB.create(member(fakeE164(2)));

    expect(mine.organisationId.equals(a)).toBe(true);
    expect(await inA.findMany({})).toHaveLength(1);
    expect(await inA.findById(theirs._id)).toBeUndefined();
    expect(await inA.findFirst({ phone: fakeE164(2) })).toBeUndefined();
    expect(await inA.count({})).toBe(1);
    await expect(inA.update(theirs._id, { role: "ADMIN" })).rejects.toThrow();
    await expect(inA.delete(theirs._id)).rejects.toThrow();
    expect((await inB.getById(theirs._id)).role).toBe("AGENT");
  });

  test("a tenant id smuggled into a filter is overridden", async () => {
    const [a, b] = [new ObjectId(), new ObjectId()];
    await scoped(mongo.db.members, b).create(member(fakeE164(2)));
    const found = await scoped(mongo.db.members, a).findMany({
      filter: { organisationId: b },
    });
    expect(found).toEqual([]);
  });

  test("a cursor of another organisation is refused", async () => {
    const [a, b] = [new ObjectId(), new ObjectId()];
    for (const n of [1, 2, 3]) {
      await scoped(mongo.db.members, a).create(member(fakeE164(n)));
    }
    const page = await scoped(mongo.db.members, a).paginateByCursor({
      limit: 1,
    });
    expect(page.nextCursor).not.toBeNull();
    await expect(
      scoped(mongo.db.members, b).paginateByCursor({
        limit: 1,
        after: page.nextCursor,
      }),
    ).rejects.toThrow();
  });
});

describe("the collections", () => {
  test("every organisation-owned collection leads every index with organisationId", () => {
    const owned = Object.entries(collections).filter(([, definition]) =>
      isTenantOwned(definition, "organisationId"),
    );
    expect(owned.map(([name]) => name)).toEqual(["members"]);
    for (const [, definition] of owned) {
      for (const index of definition.indexes) {
        expect(Object.keys(index.key)[0]).toBe("organisationId");
      }
    }
  });

  test("the global and the tenant collections are told apart", () => {
    const names = Object.keys(collections).sort();
    expect(names).toEqual([
      "categories",
      "countries",
      "members",
      "organisations",
      "safePlaces",
      "translations",
    ]);
    expect(isTenantOwned(collections.countries, "organisationId")).toBe(false);
    expect(isTenantOwned(collections.safePlaces, "organisationId")).toBe(false);
    expect(isTenantOwned(collections.organisations, "organisationId")).toBe(
      false,
    );
    expect(isTenantOwned(collections.translations, "organisationId")).toBe(
      false,
    );
  });
});
