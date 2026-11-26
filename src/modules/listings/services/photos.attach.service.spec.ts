import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn, uploadPhoto } from "~/fixtures";
import { jpegOf } from "~/images";
import { foundContent, listingsAs, lostContent, photoOf } from "~/listings";
import { issuesOf } from "~/refusals";
import { UPLOADS_PER_HOUR } from "./listing-media.service";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

describe("who may attach a photo", () => {
  test("an agent of the organisation keeps the photos of a colleague's listing when editing it", async () => {
    const [author, agent] = [
      await listingsAs(kit, 1),
      await listingsAs(kit, 2),
    ];
    const key = await photoOf(kit, author.token);
    const declared = await author.listings.declare(
      author.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST" },
      null,
    );
    const edited = await agent.listings.update(
      agent.viewer,
      declared._id.toHexString(),
      lostContent({ photoKeys: [key], title: "Titre d'un collègue" }),
      declared.version,
      false,
    );
    expect(edited.photos).toEqual([{ key, status: "PENDING" }]);
    const stranger = await issuesOf(
      agent.listings.declare(
        agent.viewer,
        { ...lostContent({ photoKeys: [key] }), kind: "LOST" },
        null,
      ),
    );
    expect(stranger[0]?.path).toBe("photoKeys.0");
  });

  test("two declarations racing for one uploaded key: one wins, the other is refused", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const declare = () =>
      me.listings.declare(
        me.viewer,
        { ...lostContent({ photoKeys: [key] }), kind: "LOST" },
        null,
      );
    const settled = await Promise.allSettled([declare(), declare()]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(await mongo.db.listings.count({ "photos.key": key })).toBe(1);
  });
});

describe("a found item at an organisation", () => {
  test("only in an organisation's register", async () => {
    const me = await listingsAs(kit);
    const content = foundContent({
      place: {
        label: "Mairie de test",
        point: { latitude: 4.05, longitude: 9.7 },
        keptAt: "AT_ORGANISATION",
      },
    });
    const outside = await issuesOf(
      me.listings.declare(me.viewer, { ...content, kind: "FOUND" }, null),
    );
    expect(outside.map((i) => i.path)).toEqual(["place.keptAt"]);
    const inside = await me.listings.declare(
      me.viewer,
      { ...content, kind: "FOUND" },
      new ObjectId(),
    );
    expect(inside.place.keptAt).toBe("AT_ORGANISATION");
  });
});

describe("the upload budget", () => {
  test("an account that uploaded its thirty in the hour is refused the next with a 429", async () => {
    const { account, token } = await signedIn(kit);
    for (let n = 0; n < UPLOADS_PER_HOUR; n += 1) {
      await mongo.db.listingUploads.create({
        _id: crypto.randomUUID(),
        accountId: account.id,
        contentType: "image/jpeg",
        size: 1,
      });
    }
    expect((await uploadPhoto(kit, token, await jpegOf(300, 200))).status).toBe(
      429,
    );
    const other = await signedIn(kit, { phone: "+237600000002" });
    expect(
      (await uploadPhoto(kit, other.token, await jpegOf(300, 200))).status,
    ).toBe(200);
  });
});
