import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { documentContent, photoOf } from "~/listings";
import { fakeCniLines } from "~/ocr";

// `suggestFromPhoto` over HTTP (spec §4.3, §5.5): who may call it, what it
// returns, and the one thing it must never do, send an ID document's photo to
// Claude.

const SUGGEST = graphql(`
  mutation SuggestFromPhoto($input: SuggestFromPhotoInput!) {
    suggestFromPhoto(input: $input) {
      categoryKey title description
      attributes { colours brand marks }
      promptVersion schemaVersion
    }
  }
`);

const DECLARE = graphql(`
  mutation DeclareForSuggest($input: DeclareListingInput!) {
    declareListing(input: $input) { id }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const suggest = (
  token: string | null,
  photoKey: string,
  extra: { categoryKey?: string } = {},
) =>
  kit.client(token).query(SUGGEST, {
    variables: {
      input: { photoKey, countryCode: "CM", categoryKey: "PHONE", ...extra },
    },
  });

describe("suggestFromPhoto", () => {
  test("needs a signed-in account", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    const result = await suggest(null, key);
    expect(codeOf(result)).toBe("auth.errors.unauthenticated");
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("a suspended account is refused before anything is read", async () => {
    const { token, account } = await signedIn(kit);
    const key = await photoOf(kit, token);
    await kit.auth.accounts.update(account, {
      suspendedAt: "2026-11-25T10:00:00.000Z",
    });
    const result = await suggest(token, key);
    expect(codeOf(result)).toBe("accounts.errors.suspended");
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("answers the suggestion for the viewer's own photo", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    const result = await suggest(token, key);
    expect(result.errors).toBeUndefined();
    expect(result.data?.suggestFromPhoto).toEqual({
      categoryKey: "PHONE",
      title: "Téléphone noir",
      description: "Un téléphone noir avec un étui, vu de face.",
      attributes: { colours: ["noir"], brand: "Marque d'essai", marks: null },
      promptVersion: 1,
      schemaVersion: 1,
    });
  });

  test("a key that is no upload of the viewer's is not found, as is a malformed one", async () => {
    const owner = await signedIn(kit, { phone: "+23760000001" });
    const other = await signedIn(kit, { phone: "+23760000002" });
    const key = await photoOf(kit, owner.token);
    for (const photoKey of [
      key,
      "nope",
      "00000000-0000-4000-8000-000000000000",
    ]) {
      expect(codeOf(await suggest(other.token, photoKey))).toBe(
        "ai.errors.photo-not-found",
      );
    }
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("a missing, unknown or non-object category is refused with 422", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    for (const categoryKey of ["NOPE", "CNI"]) {
      expect(codeOf(await suggest(token, key, { categoryKey }))).toBe(
        "ai.errors.document-photo",
      );
    }
    const missing = await kit.client(token).query(SUGGEST, {
      variables: { input: { photoKey: key, countryCode: "CM" } as never },
    });
    expect(missing.errors?.length).toBeGreaterThan(0);
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("a document category is refused with 422 and Claude is never called", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    const result = await suggest(token, key, { categoryKey: "DOCUMENT" });
    expect(codeOf(result)).toBe("ai.errors.document-photo");
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("an ID-like photo is refused, and so is the photo of a declared ID document", async () => {
    const { token } = await signedIn(kit);
    const like = await photoOf(kit, token);
    kit.ocr.answer(fakeCniLines());
    expect(codeOf(await suggest(token, like))).toBe("ai.errors.document-photo");
    const doc = await photoOf(kit, token);
    await kit.client(token).query(DECLARE, {
      variables: {
        input: {
          kind: "FOUND",
          content: documentContent({ photoKeys: [doc] }),
          publish: true,
        },
      },
    });
    await kit.auth.background.settled();
    kit.ocr.answer([]);
    expect(codeOf(await suggest(token, doc))).toBe("ai.errors.document-photo");
    expect(kit.claude.model.requests).toEqual([]);
  });

  test("Claude down answers 503 `suggestion-unavailable`", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    kit.claude.fail();
    const result = await suggest(token, key);
    expect(codeOf(result)).toBe("ai.errors.suggestion-unavailable");
    expect(result.status).toBe(503);
  });

  test("is in the viewer's language", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    await kit.client(token, "en").query(SUGGEST, {
      variables: {
        input: { photoKey: key, countryCode: "CM", categoryKey: "PHONE" },
      },
    });
    expect(kit.claude.model.requests[0]?.system?.[0]?.text).toContain(
      "English",
    );
  });
});
