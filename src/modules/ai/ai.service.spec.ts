import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { jpegOf } from "~/images";
import { documentContent, foundContent, listingsAs, photoOf } from "~/listings";
import { fakeCniLines } from "~/ocr";
import { refusal } from "~/refusals";
import type { RemotePhoto } from "./ai.service";

// The gate of every call that would send a photo off the VPS (AGENTS.md, "ID
// documents never leave the VPS"): a spy stands for the remote service, and
// it must never be called for an ID document's photo.

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

function remoteSpy() {
  const sent: Uint8Array[] = [];
  return {
    sent,
    call: async (bytes: Uint8Array) => {
      sent.push(bytes);
      return "a suggestion";
    },
  };
}

// A drawn photo as the guard is given it, `over` replacing fields.
const photo = async (
  over: Partial<RemotePhoto> = {},
): Promise<RemotePhoto> => ({
  bytes: await jpegOf(400, 300),
  countryCode: "CM",
  categoryKey: null,
  key: null,
  ...over,
});

describe("the remote photo guard", () => {
  test("passes an object's photo the OCR finds nothing of an ID on, as it is", async () => {
    const me = await listingsAs(kit);
    const remote = remoteSpy();
    const shot = await photo({ categoryKey: "PHONE" });
    expect(await me.services.remotePhotos.send(shot, remote.call)).toBe(
      "a suggestion",
    );
    expect(remote.sent).toEqual([shot.bytes]);
  });

  test("refuses a photo of a document category before anything reads it", async () => {
    const me = await listingsAs(kit);
    const remote = remoteSpy();
    for (const categoryKey of ["DOCUMENT", "CNI", "PASSPORT"]) {
      const error = await refusal(
        me.services.remotePhotos.send(
          await photo({ categoryKey }),
          remote.call,
        ),
      );
      expect(error.extensions["code"]).toBe("ai.errors.document-photo");
    }
    expect(remote.sent).toEqual([]);
    expect(kit.ocr.images).toEqual([]);
  });

  test("refuses the key of an ID document's photo, and of an object's ID-like one", async () => {
    const me = await listingsAs(kit);
    const remote = remoteSpy();
    const docKey = await photoOf(kit, me.token);
    await me.listings.declare(
      me.viewer,
      {
        ...documentContent({ photoKeys: [docKey] }),
        kind: "FOUND",
        publish: true,
      },
      null,
    );
    kit.ocr.answer(fakeCniLines());
    const likeKey = await photoOf(kit, me.token);
    await me.listings.declare(
      me.viewer,
      {
        ...foundContent({ photoKeys: [likeKey] }),
        kind: "FOUND",
        publish: true,
      },
      null,
    );
    await kit.auth.background.settled();
    kit.ocr.answer([]);
    for (const key of [docKey, likeKey]) {
      const error = await refusal(
        me.services.remotePhotos.send(await photo({ key }), remote.call),
      );
      expect(error.extensions["code"]).toBe("ai.errors.document-photo");
    }
    expect(remote.sent).toEqual([]);
  });

  test("refuses a photo the local OCR finds ID-like, whatever its category says", async () => {
    const me = await listingsAs(kit);
    const remote = remoteSpy();
    kit.ocr.answer(fakeCniLines());
    const error = await refusal(
      me.services.remotePhotos.send(
        await photo({ categoryKey: "WALLET_BAG" }),
        remote.call,
      ),
    );
    expect(error.extensions["code"]).toBe("ai.errors.document-photo");
    expect(kit.ocr.images).toHaveLength(1);
    expect(remote.sent).toEqual([]);
  });

  test("fails closed when the local OCR cannot check the photo", async () => {
    const me = await listingsAs(kit);
    const remote = remoteSpy();
    kit.ocr.fail();
    const error = await refusal(
      me.services.remotePhotos.send(await photo(), remote.call),
    );
    expect(error.extensions["code"]).toBe("ai.errors.unavailable");
    expect(remote.sent).toEqual([]);
  });
});
