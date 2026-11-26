import { beforeEach, describe, expect, test } from "bun:test";
import type { MediaUploaded } from "@softistx/alxia-media";
import { janusAccess, viewerOf } from "@/auth/access";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { listingsAs, lostContent, photoOf } from "~/listings";
import { ListingMedia, UPLOADS_PER_HOUR } from "./listing-media.service";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const rulesFor = (viewer: ReturnType<typeof viewerOf> | null) =>
  new ListingMedia({
    viewer,
    access: janusAccess(kit.auth),
    mongo,
    now: () => new Date(kit.clock.now()),
  });
const as = async (n: number) => {
  const person = await signedIn(kit, { phone: fakeE164(n) });
  return { ...person, viewer: viewerOf(person.account) };
};
const uploaded = (key: string): MediaUploaded => ({
  key,
  kind: "listing-photos",
  contentType: "image/jpeg",
  size: 10,
  sizes: ["full"],
  renditions: [],
});

describe("mayWrite", () => {
  test("an anonymous request is a 401, a suspended account refused, an account allowed", async () => {
    expect(await rulesFor(null).mayWrite()).toEqual({
      code: "unauthenticated",
      status: 401,
    });
    const me = await as(1);
    expect(await rulesFor(me.viewer).mayWrite()).toBe(true);
    expect(
      await rulesFor({ ...me.viewer, suspendedAt: new Date() }).mayWrite(),
    ).toBe(false);
  });

  test("the thirty-first upload of the hour is a 429, an hour later it is allowed again", async () => {
    const me = await as(1);
    for (let n = 0; n < UPLOADS_PER_HOUR; n += 1) {
      await mongo.db.listingUploads.create({
        _id: crypto.randomUUID(),
        accountId: me.account.id,
        contentType: "image/jpeg",
        size: 1,
      });
    }
    expect(await rulesFor(me.viewer).mayWrite()).toEqual({
      code: "too_many_uploads",
      status: 429,
    });
    kit.clock.advance(2 * 3_600_000);
    expect(await rulesFor(me.viewer).mayWrite()).toBe(true);
  });
});

describe("recordUpload", () => {
  test("keeps who uploaded the key, and nothing for an anonymous request", async () => {
    const me = await as(1);
    const key = crypto.randomUUID();
    await rulesFor(me.viewer).recordUpload(uploaded(key));
    expect(await mongo.db.listingUploads.findById(key)).toMatchObject({
      accountId: me.account.id,
      size: 10,
    });
    const other = crypto.randomUUID();
    await rulesFor(null).recordUpload(uploaded(other));
    expect(await mongo.db.listingUploads.findById(other)).toBeUndefined();
  });
});

describe("mayRead", () => {
  test("a key nobody knows is refused, an unattached one is its uploader's", async () => {
    const [me, other] = [await as(1), await as(2)];
    expect(await rulesFor(me.viewer).mayRead(crypto.randomUUID())).toBe(false);
    const key = crypto.randomUUID();
    await rulesFor(me.viewer).recordUpload(uploaded(key));
    expect(await rulesFor(me.viewer).mayRead(key)).toBe(true);
    expect(await rulesFor(other.viewer).mayRead(key)).toBe(false);
    expect(await rulesFor(null).mayRead(key)).toBe(false);
  });

  test("a suspended account reads nothing, not even its own photo", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    expect(
      await rulesFor({ ...me.viewer, suspendedAt: new Date() }).mayRead(key),
    ).toBe(false);
  });

  test("a public ready photo is anybody's, an ID document's is its editors' alone", async () => {
    const me = await listingsAs(kit);
    const stranger = await as(2);
    const [photo, scan] = [
      await photoOf(kit, me.token),
      await photoOf(kit, me.token),
    ];
    await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [photo] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    await me.listings.declare(
      me.viewer,
      {
        ...lostContent({
          categoryKey: "DOCUMENT",
          documentType: "CNI",
          photoKeys: [scan],
        }),
        kind: "LOST",
        publish: true,
      },
      null,
    );
    await kit.auth.background.settled();
    expect(await rulesFor(null).mayRead(photo)).toBe(true);
    expect(await rulesFor(stranger.viewer).mayRead(photo)).toBe(true);
    expect(await rulesFor(null).mayRead(scan)).toBe(false);
    expect(await rulesFor(stranger.viewer).mayRead(scan)).toBe(false);
    expect(await rulesFor(me.viewer).mayRead(scan)).toBe(true);
  });
});
