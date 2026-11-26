import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { foundContent, listingsAs, lostContent, photoOf } from "~/listings";
import { issuesOf, refusal } from "~/refusals";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const codeOf = (promise: Promise<unknown>) =>
  refusal(promise).then((e) => e.extensions["code"]);

describe("declare", () => {
  test("a draft is private, stamped with its author, with no expiry", async () => {
    const me = await listingsAs(kit);
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST" },
      null,
    );
    expect(draft).toMatchObject({
      kind: "LOST",
      authorId: me.viewer.id,
      orgId: null,
      status: "DRAFT",
      expiresAt: null,
      publishedAt: null,
      extendedCount: 0,
      createdBy: me.viewer.id,
    });
    expect(draft.place.point.coordinates).toEqual([9.70456, 4.05123]);
    await expect(
      me.listings.publicById(draft._id.toHexString()),
    ).rejects.toThrow();
  });

  test("published without photos it opens at once for 90 days", async () => {
    const me = await listingsAs(kit);
    const open = await me.listings.declare(
      me.viewer,
      { ...foundContent(), kind: "FOUND", publish: true },
      null,
    );
    expect(open.status).toBe("OPEN");
    const days =
      ((open.expiresAt?.getTime() ?? 0) - (open.publishedAt?.getTime() ?? 0)) /
      86_400_000;
    expect(Math.round(days)).toBe(90);
    expect(
      (await me.listings.publicById(open._id.toHexString()))._id.equals(
        open._id,
      ),
    ).toBe(true);
  });

  test("published with photos it is pending until the job settles them, then opens", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const pending = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    expect(pending.status).toBe("PENDING");
    expect(pending.photos).toEqual([
      { key, status: "PENDING", blurredKey: null },
    ]);
    await kit.auth.background.settled();
    const settled = await me.listings.find(pending._id.toHexString());
    expect(settled?.status).toBe("OPEN");
    expect(settled?.photos).toEqual([
      { key, status: "READY", blurredKey: null },
    ]);
  });

  test("a photo missing from the bucket is dropped, and the listing opens without it", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    kit.storage.objects.clear();
    const pending = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    const settled = await me.listings.find(pending._id.toHexString());
    expect(settled).toMatchObject({ status: "OPEN", photos: [] });
  });

  test("a document's listing is pending until its photo is blurred, then opens", async () => {
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
    expect(declared.status).toBe("PENDING");
    await kit.auth.background.settled();
    const after = await me.listings.find(declared._id.toHexString());
    expect(after).toMatchObject({
      status: "OPEN",
      photos: [{ key, status: "READY", blurredKey: expect.any(String) }],
    });
  });

  test("a bad content is one invalid-input with each issue on its path", async () => {
    const me = await listingsAs(kit);
    const issues = await issuesOf(
      me.listings.declare(
        me.viewer,
        {
          ...lostContent({
            categoryKey: "GHOST",
            date: "2999-01-01",
            place: {
              label: "x",
              point: { latitude: 4, longitude: 9 },
              radiusM: 50,
            },
            photoKeys: ["00000000-0000-4000-8000-000000000001"],
          }),
          kind: "LOST",
        },
        null,
      ),
    );
    expect(issues.map((i) => i.path).sort()).toEqual([
      "categoryKey",
      "date",
      "photoKeys.0",
      "place.radiusM",
    ]);
  });

  test("an unknown country is the config refusal, an inactive category is invalid", async () => {
    const me = await listingsAs(kit);
    expect(
      await codeOf(
        me.listings.declare(
          me.viewer,
          { ...lostContent({ countryCode: "ZZ" }), kind: "LOST" },
          null,
        ),
      ),
    ).toBe("config.errors.country-not-found");
    await mongo.db.categories.update("PHONE", { active: false });
    const issues = await issuesOf(
      me.listings.declare(me.viewer, { ...lostContent(), kind: "LOST" }, null),
    );
    expect(issues[0]?.code).toBe("listings.errors.category-invalid");
  });

  test("another account's upload, or one on another listing, cannot be attached", async () => {
    const [me, other] = [await listingsAs(kit, 1), await listingsAs(kit, 2)];
    const theirs = await photoOf(kit, other.token);
    const mine = await photoOf(kit, me.token);
    const first = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [mine] }), kind: "LOST" },
      null,
    );
    const issues = await issuesOf(
      me.listings.declare(
        me.viewer,
        { ...lostContent({ photoKeys: [theirs, mine] }), kind: "LOST" },
        null,
      ),
    );
    expect(issues.map((i) => i.path)).toEqual(["photoKeys.0", "photoKeys.1"]);
    expect(first.photos).toHaveLength(1);
  });
});

describe("update", () => {
  test("replaces the content under the version, and a stale version is 409", async () => {
    const me = await listingsAs(kit);
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST" },
      null,
    );
    const id = draft._id.toHexString();
    const next = await me.listings.update(
      me.viewer,
      id,
      lostContent({ title: "Titre changé" }),
      draft.version,
      false,
    );
    expect(next.title).toBe("Titre changé");
    expect(next.version).toBeGreaterThan(draft.version);
    expect(
      await codeOf(
        me.listings.update(me.viewer, id, lostContent(), draft.version, false),
      ),
    ).toBe("listings.errors.stale-version");
  });

  test("publish takes a draft public, and a photo taken out is removed from storage", async () => {
    const me = await listingsAs(kit);
    const [a, b] = [await photoOf(kit, me.token), await photoOf(kit, me.token)];
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [a, b] }), kind: "LOST" },
      null,
    );
    const id = draft._id.toHexString();
    const published = await me.listings.update(
      me.viewer,
      id,
      lostContent({ photoKeys: [a] }),
      draft.version,
      true,
    );
    expect(published.status).toBe("PENDING");
    expect(kit.storage.objects.has(`listing-photos/${b}/full`)).toBe(false);
    expect(kit.storage.objects.has(`listing-photos/${a}/full`)).toBe(true);
    await kit.auth.background.settled();
    expect((await me.listings.find(id))?.status).toBe("OPEN");
  });

  test("a closed or removed listing is not editable", async () => {
    const me = await listingsAs(kit);
    const open = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST", publish: true },
      null,
    );
    const id = open._id.toHexString();
    const closed = await me.listings.close(me.viewer, id, "RECOVERED");
    expect(
      await codeOf(
        me.listings.update(me.viewer, id, lostContent(), closed.version, false),
      ),
    ).toBe("listings.errors.invalid-status");
  });
});
