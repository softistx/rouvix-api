import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { documentContent, foundContent, photoOf } from "~/listings";
import { fakeCniLines } from "~/ocr";

// AGENTS.md, "ID documents never leave the VPS": an ID document's photo goes
// to the local OCR and blur only. At run time, a document declared through
// the API is processed while every port that reaches out of the process is a
// spy (the geocoder, the SMS sender, the mailer, and `fetch` itself), and none
// is called; the OCR is the one given the photo. In the code, the pipeline's
// files import no remote adapter, and no source file imports a provider SDK
// or the house AI SDK outside the gate.

const DECLARE_MUTATION = graphql(`
  mutation DeclareForRemote($input: DeclareListingInput!) {
    declareListing(input: $input) { id status }
  }
`);

let kit: AuthApp;
let fetched: string[];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
  kit.ocr.answer(fakeCniLines());
  fetched = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push(String(input instanceof Request ? input.url : input));
      return realFetch(input, init);
    },
    realFetch,
  );
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("an ID document's photo, at run time", () => {
  test("reaches the local OCR and blur, and no port that leaves the process", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    const uploaded = kit.storage.objects.size;
    const declared = await kit.client(token).query(DECLARE_MUTATION, {
      variables: {
        input: {
          kind: "FOUND",
          content: documentContent({ photoKeys: [key] }),
          publish: true,
        },
      },
    });
    expect(declared.data?.declareListing.status).toBe("PENDING");
    await kit.auth.background.settled();
    expect(kit.ocr.images).toHaveLength(1);
    // The blurred copy is the one object the job added, in our own bucket.
    expect(kit.storage.objects.size).toBe(uploaded + 1);
    expect(fetched).toEqual([]);
    expect(kit.geocoder.asked).toEqual([]);
    expect(kit.sms.sent).toEqual([]);
    expect(kit.mailer.sent).toEqual([]);
  });

  test("an object's photo found ID-like is held the same way", async () => {
    const { token } = await signedIn(kit);
    const key = await photoOf(kit, token);
    await kit.client(token).query(DECLARE_MUTATION, {
      variables: {
        input: {
          kind: "FOUND",
          content: foundContent({ photoKeys: [key] }),
          publish: true,
        },
      },
    });
    await kit.auth.background.settled();
    expect(fetched).toEqual([]);
    expect(kit.geocoder.asked).toEqual([]);
  });
});

const PIPELINE = [
  "src/modules/listings/services/id-documents.service.ts",
  "src/modules/listings/services/photos.service.ts",
  "src/modules/listings/rules/id-fields.rules.ts",
  "src/modules/listings/rules/id-text.rules.ts",
  "src/ocr/*.ts",
  "src/redactor/*.ts",
  "src/vault/*.ts",
];
const REMOTE = [
  "@/geocoder",
  "@/sms",
  "@/mail",
  "@softistx/mail",
  "@softistx/ai-",
  "@anthropic-ai/",
  "openai",
];

const importsOf = async (path: string) =>
  [...(await Bun.file(path).text()).matchAll(/from "([^"]+)"/g)].map(
    (m) => m[1] as string,
  );

const sources = async (patterns: readonly string[]) => {
  const out: string[] = [];
  for (const pattern of patterns) {
    for await (const path of new Glob(pattern).scan(".")) {
      if (!path.endsWith(".spec.ts")) out.push(path);
    }
  }
  return out;
};

describe("an ID document's photo, in the code", () => {
  test("the pipeline imports no remote adapter", async () => {
    const found: string[] = [];
    for (const path of await sources(PIPELINE)) {
      for (const from of await importsOf(path)) {
        if (REMOTE.some((remote) => from.startsWith(remote))) {
          found.push(`${path}: ${from}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  test("no source imports a provider SDK, and the house AI SDK only behind the gate", async () => {
    const found: string[] = [];
    for (const path of await sources(["src/**/*.ts"])) {
      for (const from of await importsOf(path)) {
        const provider = /^(@anthropic-ai\/|openai|@google\/|@mistralai\/)/;
        const ai = from.startsWith("@softistx/ai-");
        if (
          provider.test(from) ||
          (ai && !path.startsWith("src/modules/ai/"))
        ) {
          found.push(`${path}: ${from}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
