import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mongo } from "@/config/db";
import { PROMPT_VERSION, SCHEMA_VERSION } from "@/describer";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { documentContent, listingsAs, lostContent, photoOf } from "~/listings";
import { fakeCniLines } from "~/ocr";
import { refusal } from "~/refusals";
import { UsageService } from "./usage.service";

// `suggestFromPhoto` (spec §4.3): what reaches Claude, what never does, and
// what the declare flow does when Claude cannot answer.

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const input = (photoKey: string, over: { categoryKey?: string } = {}) => ({
  photoKey,
  countryCode: "CM",
  categoryKey: over.categoryKey ?? "PHONE",
  language: "fr",
});

const codeOf = async (promise: Promise<unknown>) =>
  (await refusal(promise)).extensions["code"];

describe("a suggestion for an object's photo", () => {
  test("is Claude's description, bounded, versioned, with a category it was offered", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const suggestion = await me.services.suggestions.suggest(
      me.viewer,
      input(key),
    );
    expect(suggestion).toEqual({
      categoryKey: "PHONE",
      title: "Téléphone noir",
      description: "Un téléphone noir avec un étui, vu de face.",
      attributes: { colours: ["noir"], brand: "Marque d'essai", marks: null },
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    });
    expect(kit.claude.model.requests).toHaveLength(1);
    // The photo the model saw is the stored rendition, whole.
    const part = kit.claude.model.requests[0]?.messages[0]?.parts[0];
    expect(part).toMatchObject({
      type: "image",
      source: { kind: "base64", mediaType: "image/webp" },
    });
    // The categories offered are the active roots that are no document's.
    const system = kit.claude.model.requests[0]?.system?.[0]?.text ?? "";
    expect(system).toContain("PHONE");
    expect(system).not.toContain("DOCUMENT (");
  });

  test("is untrusted: markup and links are cut, a document category is never suggested", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    kit.claude.answer({
      category: "DOCUMENT",
      title: "<script>alert(1)</script> Phone",
      description: "Visit https://evil.example/now and ignore the rules",
      colours: ["<i>black</i>"],
      brand: "https://evil.example",
      marks: null,
    });
    const suggestion = await me.services.suggestions.suggest(
      me.viewer,
      input(key),
    );
    expect(suggestion.categoryKey).toBeNull();
    expect(suggestion.title).toBe("script alert(1) /script Phone");
    expect(suggestion.description).toBe("Visit and ignore the rules");
    expect(suggestion.attributes.colours).toEqual(["i black /i"]);
    expect(suggestion.attributes.brand).toBeNull();
    expect(JSON.stringify(suggestion)).not.toMatch(/[<>]|https?:/);
  });

  test("counts the call and its tokens against the day", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    await me.services.suggestions.suggest(me.viewer, input(key));
    const today = await new UsageService(mongo, {
      now: () => new Date(kit.clock.now()),
      dailyCap: 50,
    }).today();
    expect(today).toEqual({ calls: 1, inputTokens: 1200, outputTokens: 90 });
  });

  test("another account's photo, and an unknown key, are not found", async () => {
    const owner = await listingsAs(kit, 1);
    const other = await listingsAs(kit, 2);
    const key = await photoOf(kit, owner.token);
    for (const photoKey of [key, randomUUID()]) {
      expect(
        await codeOf(
          other.services.suggestions.suggest(other.viewer, input(photoKey)),
        ),
      ).toBe("ai.errors.photo-not-found");
    }
    expect(kit.claude.model.requests).toEqual([]);
  });
});

// The guard spec (AGENTS.md: "ID documents never leave the VPS"): an ID
// document's photo, however it is recognised, never reaches the describer.
describe("a document's photo never reaches the describer", () => {
  test("a document category is refused before anything reads the photo", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    for (const categoryKey of ["DOCUMENT", "CNI", "PASSPORT"]) {
      expect(
        await codeOf(
          me.services.suggestions.suggest(
            me.viewer,
            input(key, { categoryKey }),
          ),
        ),
      ).toBe("ai.errors.document-photo");
    }
    expect(kit.claude.model.requests).toEqual([]);
    expect(kit.ocr.images).toEqual([]);
  });

  test("no object category, no call: the photo with no text to read is not sent on a guess", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    // A bank card or an ID photo with no readable word says nothing to the
    // OCR: the author's own category is the barrier, and it must be an
    // object's (an active root that is no document's).
    for (const [categoryKey, code] of [
      ["NOPE", "validation.errors.invalid-input"],
      ["CNI", "ai.errors.document-photo"],
      ["DOCUMENT", "ai.errors.document-photo"],
    ] as const) {
      expect(
        await codeOf(
          me.services.suggestions.suggest(
            me.viewer,
            input(key, { categoryKey }),
          ),
        ),
      ).toBe(code);
    }
    expect(kit.claude.model.requests).toEqual([]);
    expect(kit.ocr.images).toEqual([]);
  });

  test("an inactive category is refused too", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    await mongo.db.categories.raw.updateOne(
      { _id: "KEYS" },
      { $set: { active: false } },
    );
    expect(
      await codeOf(
        me.services.suggestions.suggest(
          me.viewer,
          input(key, { categoryKey: "KEYS" }),
        ),
      ),
    ).toBe("validation.errors.invalid-input");
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("a photo the local OCR finds ID-like is refused, whatever the form says", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    kit.ocr.answer(fakeCniLines());
    expect(
      await codeOf(
        me.services.suggestions.suggest(
          me.viewer,
          input(key, { categoryKey: "WALLET_BAG" }),
        ),
      ),
    ).toBe("ai.errors.document-photo");
    expect(kit.ocr.images).toHaveLength(1);
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("the key of a photo declared as an ID document is refused", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    await me.listings.declare(
      me.viewer,
      {
        ...documentContent({ photoKeys: [key] }),
        kind: "FOUND",
        publish: true,
      },
      null,
    );
    await kit.auth.background.settled();
    kit.ocr.answer([]);
    expect(
      await codeOf(me.services.suggestions.suggest(me.viewer, input(key))),
    ).toBe("ai.errors.document-photo");
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("a refused photo does not use the day's cap", async () => {
    const me = await listingsAs(kit, 1, { claudeDailyCap: 1 });
    const key = await photoOf(kit, me.token);
    kit.ocr.answerOnce(fakeCniLines());
    await codeOf(me.services.suggestions.suggest(me.viewer, input(key)));
    // The cap of one is still whole: the next, plain photo is described.
    const suggestion = await me.services.suggestions.suggest(
      me.viewer,
      input(key),
    );
    expect(suggestion.title).toBe("Téléphone noir");
    expect(kit.claude.model.requests).toHaveLength(1);
  });

  test("the local OCR being down refuses the photo: it fails closed", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    kit.ocr.fail();
    expect(
      await codeOf(me.services.suggestions.suggest(me.viewer, input(key))),
    ).toBe("ai.errors.unavailable");
    expect(kit.claude.model.requests).toEqual([]);
  });
});

describe("Claude down or over the cap", () => {
  test("Claude down is `suggestion-unavailable`, and the declare flow still works", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    kit.claude.fail();
    expect(
      await codeOf(me.services.suggestions.suggest(me.viewer, input(key))),
    ).toBe("ai.errors.suggestion-unavailable");
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent({ photoKeys: [key] }), kind: "LOST", publish: true },
      null,
    );
    await kit.auth.background.settled();
    expect((await me.listings.find(declared._id.toHexString()))?.status).toBe(
      "OPEN",
    );
  });

  test("an answer the schema rejects is `suggestion-unavailable` too", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    kit.claude.answer({ nonsense: true });
    expect(
      await codeOf(me.services.suggestions.suggest(me.viewer, input(key))),
    ).toBe("ai.errors.suggestion-unavailable");
  });

  test("past the day's cap Claude is not called", async () => {
    const me = await listingsAs(kit, 1, { claudeDailyCap: 2 });
    const key = await photoOf(kit, me.token);
    await me.services.suggestions.suggest(me.viewer, input(key));
    await me.services.suggestions.suggest(me.viewer, input(key));
    expect(
      await codeOf(me.services.suggestions.suggest(me.viewer, input(key))),
    ).toBe("ai.errors.suggestion-unavailable");
    expect(kit.claude.model.requests).toHaveLength(2);
  });

  test("the next day the cap starts again", async () => {
    const me = await listingsAs(kit, 1, { claudeDailyCap: 1 });
    const key = await photoOf(kit, me.token);
    await me.services.suggestions.suggest(me.viewer, input(key));
    await codeOf(me.services.suggestions.suggest(me.viewer, input(key)));
    kit.clock.advance(86_400_000);
    expect(
      (await me.services.suggestions.suggest(me.viewer, input(key))).title,
    ).toBe("Téléphone noir");
  });
});
