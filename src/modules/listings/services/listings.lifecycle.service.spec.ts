import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { listingsAs, lostContent, photoOf } from "~/listings";
import { refusal } from "~/refusals";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const codeOf = (promise: Promise<unknown>) =>
  refusal(promise).then((e) => e.extensions["code"]);

describe("extend, close and remove", () => {
  test("extending adds 90 days from the expiry, three times at most", async () => {
    const me = await listingsAs(kit);
    const open = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST", publish: true },
      null,
    );
    const id = open._id.toHexString();
    let last = open;
    for (const n of [1, 2, 3]) {
      last = await me.listings.extend(me.viewer, id);
      expect(last.extendedCount).toBe(n);
    }
    const added =
      ((last.expiresAt?.getTime() ?? 0) - (open.expiresAt?.getTime() ?? 0)) /
      86_400_000;
    expect(Math.round(added)).toBe(270);
    expect(await codeOf(me.listings.extend(me.viewer, id))).toBe(
      "listings.errors.extension-limit",
    );
  });

  test("only an open listing is extended", async () => {
    const me = await listingsAs(kit);
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST" },
      null,
    );
    expect(
      await codeOf(me.listings.extend(me.viewer, draft._id.toHexString())),
    ).toBe("listings.errors.invalid-status");
  });

  test("closing records the reason and the time, and a second close is refused", async () => {
    const me = await listingsAs(kit);
    const open = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST", publish: true },
      null,
    );
    const id = open._id.toHexString();
    const closed = await me.listings.close(me.viewer, id, "GIVEN_UP");
    expect(closed).toMatchObject({
      status: "CLOSED",
      closedReason: "GIVEN_UP",
    });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(await codeOf(me.listings.close(me.viewer, id, "OTHER"))).toBe(
      "listings.errors.invalid-status",
    );
    await expect(me.listings.publicById(id)).rejects.toThrow();
  });

  test("closing an ID document's listing removes its photos from storage", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const document = lostContent({
      categoryKey: "DOCUMENT",
      documentType: "CNI",
      photoKeys: [key],
    });
    const declared = await me.listings.declare(
      me.viewer,
      { ...document, kind: "LOST", publish: true },
      null,
    );
    await me.listings.close(me.viewer, declared._id.toHexString(), "RECOVERED");
    expect(kit.storage.objects.size).toBe(0);
    expect(
      (await me.listings.find(declared._id.toHexString()))?.photos,
    ).toEqual([]);
  });

  test("closing an object's listing keeps its photos", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    await me.listings.close(me.viewer, declared._id.toHexString(), "RECOVERED");
    expect(kit.storage.objects.size).toBe(1);
  });

  test("removing takes it out of every read and removes its photos; a second time is not found", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    const id = declared._id.toHexString();
    expect(await me.listings.remove(me.viewer, id)).toBe(id);
    expect(kit.storage.objects.size).toBe(0);
    expect(
      (await me.listings.mine(me.viewer, { first: 20, after: null }))
        .totalCount,
    ).toBe(0);
    expect(await codeOf(me.listings.remove(me.viewer, id))).toBe(
      "listings.errors.listing-not-found",
    );
  });
});

describe("mine", () => {
  test("lists the viewer's own listings only, newest first, with the total", async () => {
    const [me, other] = [await listingsAs(kit, 1), await listingsAs(kit, 2)];
    for (const title of ["Premier objet", "Second objet", "Troisième objet"]) {
      await me.listings.declare(
        me.viewer,
        { ...lostContent({ title }), kind: "LOST" },
        null,
      );
    }
    await other.listings.declare(
      other.viewer,
      { ...lostContent({ title: "Autre objet" }), kind: "LOST" },
      null,
    );
    const page = await me.listings.mine(me.viewer, { first: 2, after: null });
    expect(page.totalCount).toBe(3);
    expect(page.edges.map((e) => e.node.title)).toEqual([
      "Troisième objet",
      "Second objet",
    ]);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const next = await me.listings.mine(me.viewer, {
      first: 2,
      after: page.pageInfo.endCursor,
    });
    expect(next.edges.map((e) => e.node.title)).toEqual(["Premier objet"]);
  });
});
