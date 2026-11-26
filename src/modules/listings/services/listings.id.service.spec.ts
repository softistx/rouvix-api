import { beforeEach, describe, expect, test } from "bun:test";
import { mediaObjectKey } from "@softistx/alxia-media";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { documentContent, foundContent, listingsAs, photoOf } from "~/listings";
import { fakeCniLines } from "~/ocr";
import { BLURRED_KIND, PHOTO_FULL, PHOTO_KIND } from "../listings.media";
import type { ListingContent } from "../listings.utils";

// What closing, removing and editing do to an ID document's photos and fields
// (spec §4.2, §7): nothing of the ID outlives its listing, and nothing read
// from photos that changed stays.

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
  kit.ocr.answer(fakeCniLines());
});

async function declared(
  n: number,
  content: (over: Partial<ListingContent>) => ListingContent = documentContent,
) {
  const me = await listingsAs(kit);
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(await photoOf(kit, me.token));
  const created = await me.listings.declare(
    me.viewer,
    { ...content({ photoKeys: keys }), kind: "FOUND", publish: true },
    null,
  );
  await kit.auth.background.settled();
  const id = created._id.toHexString();
  const listing = await me.listings.find(id);
  if (listing === undefined) throw new Error("gone");
  return { me, id, keys, listing };
}

const stored = (photo: { key: string; blurredKey: string | null }) => ({
  original: kit.storage.objects.has(
    mediaObjectKey(PHOTO_KIND, photo.key, PHOTO_FULL),
  ),
  blurred:
    photo.blurredKey !== null &&
    kit.storage.objects.has(mediaObjectKey(BLURRED_KIND, photo.blurredKey)),
});

const NOTHING_READ = {
  idFields: null,
  idNumberHash: null,
  public: { maskedNumber: null, holderHint: null },
};

describe("closing and removing", () => {
  test("a closed document keeps no photo, no blurred copy and no field", async () => {
    const { me, id, listing } = await declared(2);
    expect(listing.idFields).not.toBeNull();
    const closed = await me.listings.close(me.viewer, id, "RECOVERED");
    expect(closed).toMatchObject({ photos: [], ...NOTHING_READ });
    for (const photo of listing.photos) {
      expect(stored(photo)).toEqual({ original: false, blurred: false });
    }
  });

  test("a removed one neither", async () => {
    const { me, id, listing } = await declared(1);
    await me.listings.remove(me.viewer, id);
    expect(await me.listings.find(id)).toMatchObject({
      photos: [],
      ...NOTHING_READ,
    });
    expect(stored(listing.photos[0] as never)).toEqual({
      original: false,
      blurred: false,
    });
  });

  test("a closed object keeps its photos but those found ID-like", async () => {
    const me = await listingsAs(kit);
    const plain = await photoOf(kit, me.token);
    const card = await photoOf(kit, me.token);
    kit.ocr.answerOnce(["Portefeuille"]);
    kit.ocr.answerOnce(fakeCniLines());
    const created = await me.listings.declare(
      me.viewer,
      {
        ...foundContent({ photoKeys: [plain, card] }),
        kind: "FOUND",
        publish: true,
      },
      null,
    );
    await kit.auth.background.settled();
    const id = created._id.toHexString();
    const before = await me.listings.find(id);
    const closed = await me.listings.close(me.viewer, id, "OTHER");
    expect(closed.photos.map((photo) => photo.key)).toEqual([plain]);
    expect(stored(before?.photos[1] as never)).toEqual({
      original: false,
      blurred: false,
    });
  });
});

describe("editing", () => {
  test("a document that loses a photo reads the others again from the start", async () => {
    const { me, id, keys, listing } = await declared(2);
    const reads = kit.ocr.images.length;
    const edited = await me.listings.update(
      me.viewer,
      id,
      documentContent({ photoKeys: [keys[0] as string] }),
      listing.version,
      false,
    );
    expect(edited).toMatchObject({
      photos: [{ key: keys[0], status: "PENDING", blurredKey: null }],
      ...NOTHING_READ,
    });
    for (const photo of listing.photos) {
      expect(stored(photo).blurred).toBe(false);
    }
    await kit.auth.background.settled();
    expect(kit.ocr.images.length).toBe(reads + 1);
    expect((await me.listings.find(id))?.public.maskedNumber).toBe(
      "99••••••••",
    );
  });

  test("a document type that changes reads its photos again; an edit that keeps them does not", async () => {
    const { me, id, keys, listing } = await declared(1);
    const kept = await me.listings.update(
      me.viewer,
      id,
      documentContent({ photoKeys: keys, title: "CNI trouvée hier" }),
      listing.version,
      false,
    );
    expect(kept.photos).toEqual(listing.photos);
    expect(kept.idFields).toBe(listing.idFields);
    const passport = await me.listings.update(
      me.viewer,
      id,
      documentContent({ photoKeys: keys, documentType: "PASSPORT" }),
      kept.version,
      false,
    );
    expect(passport).toMatchObject({
      photos: [{ status: "PENDING", blurredKey: null }],
      ...NOTHING_READ,
    });
    await kit.auth.background.settled();
    expect((await me.listings.find(id))?.photos[0]?.blurredKey).not.toBeNull();
  });

  test("a document made an object stays blurred while the OCR finds it ID-like", async () => {
    const { me, id, keys, listing } = await declared(1);
    const object = await me.listings.update(
      me.viewer,
      id,
      foundContent({ photoKeys: keys }),
      listing.version,
      false,
    );
    expect(object).toMatchObject({
      documentType: null,
      photos: [{ status: "PENDING", blurredKey: null }],
      ...NOTHING_READ,
    });
    await kit.auth.background.settled();
    const after = await me.listings.find(id);
    expect(after?.photos[0]?.blurredKey).not.toBeNull();
    expect(after?.idFields).toBeNull();
  });
});
