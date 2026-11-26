import { beforeEach, describe, expect, test } from "bun:test";
import type { MediaBucket } from "@softistx/alxia-media";
import { ObjectId } from "mongodb";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { listingsAs, lostContent, photoOf, photosOver } from "~/listings";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

// A bucket that fails its first `failures` calls of `method`, then answers as
// the kit's own.
function flaky(method: "open" | "delete", failures: number) {
  let left = failures;
  const calls = { count: 0 };
  const bucket = new Proxy(kit.storage.bucket, {
    get(target, name) {
      const value = Reflect.get(target, name) as (
        ...args: unknown[]
      ) => unknown;
      if (name !== method) return value.bind(target);
      return (...args: unknown[]) => {
        calls.count += 1;
        if (left > 0) {
          left -= 1;
          throw new Error("bucket down");
        }
        return value.apply(target, args);
      };
    },
  }) as MediaBucket;
  return { bucket, calls };
}

describe("a pending listing always opens", () => {
  test("an update that drops every photo of a pending listing opens it", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const pending = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    await mongo.db.listings.update(pending._id, { status: "PENDING" });
    const fresh = (await me.listings.find(pending._id.toHexString()))
      ?.version as number;
    await me.listings.update(
      me.viewer,
      pending._id.toHexString(),
      lostContent({ photoKeys: [] }),
      fresh,
      false,
    );
    await kit.auth.background.settled();
    expect((await me.listings.find(pending._id.toHexString()))?.status).toBe(
      "OPEN",
    );
  });

  test("an update that keeps photos already ready opens a pending listing too", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    const id = declared._id.toHexString();
    await mongo.db.listings.update(declared._id, { status: "PENDING" });
    const fresh = (await me.listings.find(id))?.version as number;
    await me.listings.update(
      me.viewer,
      id,
      lostContent({ photoKeys: [key] }),
      fresh,
      false,
    );
    await kit.auth.background.settled();
    expect((await me.listings.find(id))?.status).toBe("OPEN");
  });
});

describe("the photo job", () => {
  test("a bucket that fails twice is tried again, and the listing opens", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST" },
      null,
    );
    await mongo.db.listings.update(declared._id, { status: "PENDING" });
    const { bucket, calls } = flaky("open", 2);
    await photosOver(kit, bucket).settleWithRetry(declared._id.toHexString());
    expect(calls.count).toBe(3);
    expect(await me.listings.find(declared._id.toHexString())).toMatchObject({
      status: "OPEN",
      photos: [{ key, status: "READY", blurredKey: null }],
    });
  });

  test("a bucket that never answers leaves the listing pending, and the error comes out", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST" },
      null,
    );
    await mongo.db.listings.update(declared._id, { status: "PENDING" });
    const { bucket } = flaky("open", 99);
    await expect(
      photosOver(kit, bucket).settleWithRetry(declared._id.toHexString()),
    ).rejects.toThrow("bucket down");
    expect((await me.listings.find(declared._id.toHexString()))?.status).toBe(
      "PENDING",
    );
  });

  test("a draft, a removed or an unknown listing is left alone", async () => {
    const me = await listingsAs(kit);
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST" },
      null,
    );
    const photos = photosOver(kit, kit.storage.bucket);
    await photos.settle(draft._id.toHexString());
    await photos.settle(new ObjectId().toHexString());
    expect((await me.listings.find(draft._id.toHexString()))?.status).toBe(
      "DRAFT",
    );
  });
});

describe("discard", () => {
  test("tries each key three times before giving up, and logs the failure", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const { bucket, calls } = flaky("delete", 2);
    await photosOver(kit, bucket).discard([{ key, blurredKey: null }]);
    expect(calls.count).toBe(3);
    expect(kit.storage.objects.size).toBe(0);
    // The upload record stays: it is the hourly budget's ledger.
    expect(await mongo.db.listingUploads.findById(key)).toBeDefined();
  });

  test("a key that keeps failing is left, with its upload record, without throwing", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const { bucket, calls } = flaky("delete", 99);
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      await photosOver(kit, bucket).discard([{ key, blurredKey: null }]);
    } finally {
      console.error = original;
    }
    expect(calls.count).toBe(3);
    expect(logged).toHaveLength(1);
    expect(kit.storage.objects.size).toBe(1);
  });
});
