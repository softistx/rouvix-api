import { beforeEach, describe, expect, test } from "bun:test";
import { mediaObjectKey } from "@softistx/alxia-media";
import { mongo } from "@/config/db";
import { RedactionError } from "@/redactor";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import {
  documentContent,
  foundContent,
  idDocumentsOver,
  listingsAs,
  photoOf,
} from "~/listings";
import { FAKE_CNI, fakeCniLines } from "~/ocr";
import { decodePng, sharpness } from "~/png";
import { BLURRED_KIND } from "../listings.media";
import type { IdFields } from "../rules";
import { PhotosService } from "./photos.service";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

// A listing published with `photos` drawn photos, its job settled.
async function published(n: number, content = documentContent) {
  const me = await listingsAs(kit);
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(await photoOf(kit, me.token));
  const declared = await me.listings.declare(
    me.viewer,
    { ...content({ photoKeys: keys }), kind: "FOUND", publish: true },
    null,
  );
  await kit.auth.background.settled();
  const listing = await me.listings.find(declared._id.toHexString());
  if (listing === undefined) throw new Error("gone");
  return { me, keys, listing };
}

const blurredBytes = (key: string) =>
  kit.storage.bytesOf(mediaObjectKey(BLURRED_KIND, key));

describe("an ID document's photo", () => {
  test("is blurred whole into a copy of its own, its fields sealed, its number hashed and masked", async () => {
    kit.ocr.answer(fakeCniLines());
    const { keys, listing } = await published(1);
    const [photo] = listing.photos;
    expect(listing.status).toBe("OPEN");
    expect(photo).toMatchObject({ key: keys[0], status: "READY" });
    expect(photo?.blurredKey).not.toBe(keys[0]);
    const copy = blurredBytes(photo?.blurredKey as string) as Uint8Array;
    const png = decodePng(await new Bun.Image(copy).png().bytes());
    expect(sharpness(png)).toBeLessThan(1);
    expect(listing.public).toEqual({
      maskedNumber: "99••••••••",
      holderHint: "Jean E.",
    });
    expect(listing.idNumberHash).toBe(
      kit.vault.numberHash("CM", FAKE_CNI.number),
    );
    expect(kit.vault.open<IdFields>(listing.idFields as string)).toEqual({
      number: FAKE_CNI.number,
      surname: "ESSAI",
      givenNames: "JEAN PIERRE",
      birthDate: "1990-01-01",
      expiryDate: null,
    });
    // Nothing of the holder is stored in clear.
    const raw = JSON.stringify(
      await mongo.db.listings.raw.findOne({ _id: listing._id }),
    );
    for (const secret of [FAKE_CNI.number, "ESSAI", "PIERRE", "1990"]) {
      expect(raw).not.toContain(secret);
    }
  });

  test("a card's front and back: each field from the photo that read it", async () => {
    kit.ocr.answerOnce(["NOM/SURNAME", "ESSAI", "PRENOMS/GIVEN NAMES", "JEAN"]);
    kit.ocr.answerOnce([`N° ${FAKE_CNI.number}`]);
    const { listing } = await published(2);
    expect(listing.photos.every((p) => p.blurredKey !== null)).toBe(true);
    expect(listing.public).toEqual({
      maskedNumber: "99••••••••",
      holderHint: "Jean E.",
    });
  });

  test("read by nobody, or with the OCR down, it is still blurred, with nothing read", async () => {
    const { listing } = await published(1);
    expect(listing.photos[0]?.blurredKey).not.toBeNull();
    expect(listing.idFields).toBeNull();
    expect(listing.public).toEqual({ maskedNumber: null, holderHint: null });
    kit.ocr.images.length = 0;
    kit.ocr.fail();
    const down = await published(1);
    // Tried three times, then given up: the listing opens all the same.
    expect(kit.ocr.images).toHaveLength(3);
    expect(down.listing.status).toBe("OPEN");
    expect(down.listing.photos[0]?.blurredKey).not.toBeNull();
    expect(down.listing.idNumberHash).toBeNull();
  });
});

describe("an object's photo", () => {
  test("shown as it is when the OCR finds nothing of an ID on it", async () => {
    kit.ocr.answer(["SAMSUNG"]);
    const { listing } = await published(1, foundContent);
    expect(listing.photos[0]).toMatchObject({
      status: "READY",
      blurredKey: null,
    });
  });

  test("blurred when the OCR finds it ID-like, or cannot check it (fail closed)", async () => {
    kit.ocr.answer(fakeCniLines());
    const idLike = await published(1, foundContent);
    expect(idLike.listing.photos[0]?.blurredKey).not.toBeNull();
    // An object's listing keeps no ID field, whatever its photo shows.
    expect(idLike.listing.idFields).toBeNull();
    kit.ocr.fail(false);
    const unchecked = await published(1, foundContent);
    expect(unchecked.listing.photos[0]?.blurredKey).not.toBeNull();
  });
});

describe("a photo the blur cannot decode", () => {
  test("is dropped, never shown", async () => {
    const { me, listing } = await published(0);
    const key = await photoOf(kit, me.token);
    await mongo.db.listings.update(listing._id, {
      status: "PENDING",
      photos: [{ key, status: "PENDING", blurredKey: null }],
    });
    const documents = idDocumentsOver(kit, kit.storage.bucket, {
      async blur() {
        throw new RedactionError("broken");
      },
    });
    await new PhotosService(mongo, kit.storage.bucket, documents).settle(
      listing._id.toHexString(),
    );
    expect(await me.listings.find(listing._id.toHexString())).toMatchObject({
      status: "OPEN",
      photos: [],
    });
  });
});
