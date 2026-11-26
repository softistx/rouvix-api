import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn, uploadPhoto } from "~/fixtures";
import { jpegOf, jpegWithMetadata, webpChunks } from "~/images";
import { listingsAs, lostContent, photoOf } from "~/listings";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const read = (key: string, token?: string) =>
  kit.app.fetch(
    new Request(`http://localhost/media/listing-photos/${key}/full`, {
      headers: {
        "x-rouvix-client": "spec",
        ...(token && { authorization: `Bearer ${token}` }),
      },
    }),
  );

describe("the upload", () => {
  test("needs a signed-in, unsuspended account and the client header", async () => {
    const bytes = await jpegOf(300, 200);
    const noToken = await kit.app.fetch(
      new Request("http://localhost/media/listing-photos", {
        method: "PUT",
        headers: { "content-type": "image/jpeg", "x-rouvix-client": "spec" },
        body: bytes as BodyInit,
      }),
    );
    expect(noToken.status).toBe(401);
    const noClient = await kit.app.fetch(
      new Request("http://localhost/media/listing-photos", {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: bytes as BodyInit,
      }),
    );
    expect(noClient.status).toBe(403);
    const { account, token } = await signedIn(kit);
    await kit.auth.accounts.update(account, {
      suspendedAt: "2026-11-27T10:00:00.000Z",
    });
    expect((await uploadPhoto(kit, token, bytes)).status).toBe(403);
    expect(kit.storage.objects.size).toBe(0);
  });

  test("keeps one WebP of 1600 px at most with no EXIF, GPS or XMP, and never the original", async () => {
    const { token } = await signedIn(kit);
    const { status, key } = await uploadPhoto(
      kit,
      token,
      await jpegWithMetadata(3200, 2000),
    );
    expect(status).toBe(200);
    expect([...kit.storage.objects.keys()]).toEqual([
      `listing-photos/${key}/full`,
    ]);
    const stored = kit.storage.bytesOf(
      `listing-photos/${key}/full`,
    ) as Uint8Array;
    expect(kit.storage.objects.get(`listing-photos/${key}/full`)?.type).toBe(
      "image/webp",
    );
    const meta = await new Bun.Image(stored).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(1600);
    expect(webpChunks(stored)).not.toContain("EXIF");
    expect(webpChunks(stored)).not.toContain("XMP ");
    expect(new TextDecoder("latin1").decode(stored)).not.toContain(
      "secret-location",
    );
  });

  test("refuses what is not a jpeg, png or webp, whatever it declares, and what is over 8 MB", async () => {
    const { token } = await signedIn(kit);
    const text = new TextEncoder().encode("not an image at all");
    expect((await uploadPhoto(kit, token, text, "image/jpeg")).status).toBe(
      415,
    );
    expect((await uploadPhoto(kit, token, text, "text/plain")).status).toBe(
      415,
    );
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    expect((await uploadPhoto(kit, token, big)).status).toBe(413);
    expect(kit.storage.objects.size).toBe(0);
  });

  test("records who uploaded the key, and only the key comes back", async () => {
    const { account, token } = await signedIn(kit);
    const { key } = await uploadPhoto(kit, token, await jpegOf(300, 200));
    expect(await mongo.db.listingUploads.findById(key)).toMatchObject({
      accountId: account.id,
      contentType: "image/jpeg",
    });
  });
});

describe("the read", () => {
  test("an upload not yet on a listing is its uploader's alone", async () => {
    const [me, other] = [
      await signedIn(kit),
      await signedIn(kit, { phone: "+237600000002" }),
    ];
    const key = await photoOf(kit, me.token);
    expect((await read(key, me.token)).status).toBe(200);
    expect((await read(key, other.token)).status).toBe(404);
    expect((await read(key)).status).toBe(404);
  });

  test("a photo of a public listing is read by anybody once it is ready, not before", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST" },
      null,
    );
    expect((await read(key)).status).toBe(404);
    await me.listings.update(
      me.viewer,
      declared._id.toHexString(),
      lostContent({ photoKeys: [key] }),
      declared.version,
      true,
    );
    await kit.auth.background.settled();
    const visitor = await read(key);
    expect(visitor.status).toBe(200);
    expect(visitor.headers.get("content-type")).toBe("image/webp");
    expect((await read(key, me.token)).status).toBe(200);
  });

  test("an ID document's photo is its author's alone, even when public", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const content = lostContent({
      categoryKey: "DOCUMENT",
      documentType: "CNI",
      photoKeys: [key],
    });
    await me.listings.declare(
      me.viewer,
      { ...content, kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    expect((await read(key)).status).toBe(404);
    expect((await read(key, me.token)).status).toBe(200);
  });

  test("a closed or removed listing's photos are no longer public", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    expect((await read(key)).status).toBe(200);
    await me.listings.close(me.viewer, declared._id.toHexString(), "OTHER");
    expect((await read(key)).status).toBe(404);
    expect((await read(key, me.token)).status).toBe(200);
  });
});
