import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { noEmbedder } from "@/embedder";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { documentContent, listingsAs, photoOf } from "~/listings";
import { publishFound } from "~/search";
import { ListingEmbeddings } from "./listing-embeddings.service";

// The vectors of the listings' text: written under the version they were made
// from and never for an ID document; read for one model only.

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const embedding = (model = "nomic-embed-text") => ({
  model,
  textHash: "a".repeat(64),
  vector: Array.from({ length: 768 }, () => 0.5),
});

describe("the listings' embeddings", () => {
  test("stores a vector under the version it was made from, and refuses a stale one", async () => {
    const me = await listingsAs(kit, 1, { embedder: noEmbedder });
    const listing = await publishFound(me);
    const store = new ListingEmbeddings(mongo);
    const id = listing._id.toHexString();
    expect(await store.store(id, listing.version + 1, embedding())).toBe(false);
    expect(await store.store(id, listing.version, embedding())).toBe(true);
    const found = await mongo.db.listings.findById(id);
    expect(found?.embedding?.vector).toHaveLength(768);
    // Derived: the version stays.
    expect(found?.version).toBe(listing.version);
  });

  test("never stores a vector for an ID document", async () => {
    const me = await listingsAs(kit, 1, { embedder: noEmbedder });
    const key = await photoOf(kit, me.token);
    const listing = await me.listings.declare(
      me.viewer,
      {
        ...documentContent({ photoKeys: [key] }),
        kind: "FOUND",
        publish: true,
      },
      null,
    );
    const id = listing._id.toHexString();
    const current = await mongo.db.listings.findById(id);
    expect(
      await new ListingEmbeddings(mongo).store(
        id,
        current?.version ?? 0,
        embedding(),
      ),
    ).toBe(false);
    expect((await mongo.db.listings.findById(id))?.embedding).toBeNull();
  });

  test("reads the vectors of one model, leaving out a listing with none or another's", async () => {
    const me = await listingsAs(kit, 1, { embedder: noEmbedder });
    const a = await publishFound(me);
    const b = await publishFound(me);
    const c = await publishFound(me);
    const store = new ListingEmbeddings(mongo);
    await store.store(a._id.toHexString(), a.version, embedding());
    await store.store(b._id.toHexString(), b.version, embedding("other-model"));
    const found = await store.of([a._id, b._id, c._id], "nomic-embed-text");
    expect([...found.keys()]).toEqual([a._id.toHexString()]);
  });
});
