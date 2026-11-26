import { beforeEach, describe, expect, test } from "bun:test";
import { AiError } from "@softistx/ai-core";
import { mongo } from "@/config/db";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, noEmbedder } from "@/embedder";
import { fakeOllama } from "~/ai";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import {
  documentContent,
  foundContent,
  listingsAs,
  lostContent,
  photoOf,
} from "~/listings";
import { publishFound } from "~/search";
import { embeddingTextOf, textHashOf } from "../ai.rules";

// The embedding job (spec §4.4): each open listing's text is embedded on this
// machine and kept on the listing; an ID document's never is.

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const read = async (id: { toHexString(): string }) => {
  const listing = await mongo.db.listings.findById(id.toHexString());
  if (listing === undefined) throw new Error("the listing is gone");
  return listing;
};

const stored = async (id: { toHexString(): string }) =>
  (await mongo.db.listings.findById(id.toHexString()))?.embedding ?? null;

describe("the embedding job", () => {
  test("embeds an open listing's text and keeps the vector on it", async () => {
    const me = await listingsAs(kit);
    const listing = await publishFound(me);
    await kit.auth.background.settled();
    const embedding = await stored(listing._id);
    expect(embedding?.model).toBe(EMBEDDING_MODEL);
    expect(embedding?.vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const text = embeddingTextOf(listing) as string;
    expect(embedding?.textHash).toBe(textHashOf(text));
    expect(kit.ollama.adapter.calls).toEqual([[`search_document: ${text}`]]);
  });

  test("waits for the photos: a pending listing is embedded once it opens", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const listing = await me.listings.declare(
      me.viewer,
      { ...foundContent({ photoKeys: [key] }), kind: "FOUND", publish: true },
      null,
    );
    expect(listing.status).toBe("PENDING");
    await kit.auth.background.settled();
    expect(
      (await mongo.db.listings.findById(listing._id.toHexString()))?.status,
    ).toBe("OPEN");
    expect(await stored(listing._id)).not.toBeNull();
  });

  test("a draft is not embedded, a published one is", async () => {
    const me = await listingsAs(kit);
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST" },
      null,
    );
    await kit.auth.background.settled();
    expect(await stored(draft._id)).toBeNull();
    expect(kit.ollama.adapter.calls).toEqual([]);
    await me.listings.update(
      me.viewer,
      draft._id.toHexString(),
      lostContent(),
      draft.version,
      true,
    );
    await kit.auth.background.settled();
    expect(await stored(draft._id)).not.toBeNull();
  });

  test("a text that did not change is not embedded again, an edited one is", async () => {
    const me = await listingsAs(kit);
    const listing = await publishFound(me);
    await kit.auth.background.settled();
    const first = await stored(listing._id);
    let current = await read(listing._id);
    // The same content again: the hash matches, no call.
    await me.listings.update(
      me.viewer,
      listing._id.toHexString(),
      foundContent(),
      current.version,
      false,
    );
    await kit.auth.background.settled();
    expect(kit.ollama.adapter.calls).toHaveLength(1);
    expect((await stored(listing._id))?.textHash).toBe(
      first?.textHash as string,
    );
    current = await read(listing._id);
    await me.listings.update(
      me.viewer,
      listing._id.toHexString(),
      foundContent({ title: "Un sac bleu trouvé" }),
      current.version,
      false,
    );
    await kit.auth.background.settled();
    expect(kit.ollama.adapter.calls).toHaveLength(2);
    expect((await stored(listing._id))?.textHash).not.toBe(first?.textHash);
  });

  test("an ID document's text is never embedded", async () => {
    const me = await listingsAs(kit);
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
    await kit.auth.background.settled();
    expect(
      (await mongo.db.listings.findById(listing._id.toHexString()))?.status,
    ).toBe("OPEN");
    expect(await stored(listing._id)).toBeNull();
    expect(kit.ollama.adapter.calls).toEqual([]);
  });

  test("a listing turned into an ID document loses its vector", async () => {
    const me = await listingsAs(kit);
    const listing = await publishFound(me);
    await kit.auth.background.settled();
    expect(await stored(listing._id)).not.toBeNull();
    const current = await read(listing._id);
    await me.listings.update(
      me.viewer,
      listing._id.toHexString(),
      documentContent(),
      current.version,
      false,
    );
    await kit.auth.background.settled();
    expect(await stored(listing._id)).toBeNull();
    expect(kit.ollama.adapter.calls).toHaveLength(1);
  });

  test("a removed listing keeps no vector", async () => {
    const me = await listingsAs(kit);
    const listing = await publishFound(me);
    await kit.auth.background.settled();
    await me.listings.remove(me.viewer, listing._id.toHexString());
    expect(await stored(listing._id)).toBeNull();
  });

  test("Ollama down leaves the listing open and searchable by its words, after three tries", async () => {
    const down = fakeOllama({ error: new AiError("MODEL_ERROR", "down") });
    const me = await listingsAs(kit, 1, { embedder: down.embedder });
    const listing = await publishFound(me);
    await kit.auth.background.settled();
    expect(down.adapter.calls).toHaveLength(3);
    const found = await mongo.db.listings.findById(listing._id.toHexString());
    expect(found?.status).toBe("OPEN");
    expect(found?.embedding).toBeNull();
  });

  test("without a server configured, nothing is embedded and nothing is tried", async () => {
    const me = await listingsAs(kit, 1, { embedder: noEmbedder });
    const listing = await publishFound(me);
    await kit.auth.background.settled();
    expect(await stored(listing._id)).toBeNull();
    expect(kit.ollama.adapter.calls).toEqual([]);
  });
});
