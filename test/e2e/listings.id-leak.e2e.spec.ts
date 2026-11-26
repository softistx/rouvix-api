import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { documentContent, listingsAs, photoOf } from "~/listings";
import { FAKE_CNI, fakeCniLines } from "~/ocr";

// The leak spec of the ID document pipeline (spec §4.2, §8; AGENTS.md "Masked
// by default"): whatever a visitor, or another signed-in account (a would-be
// claimant), asks of a found CNI, through every read that returns a listing
// and the media routes, the answer holds none of what the OCR read but the
// masked number and the holder hint, never the photo's own key, never the
// sealed fields or the number's hash. Plain HTTP, as the BFF sends it.

const EVERYTHING = `{
  id kind categoryKey countryCode documentType title description date status
  photoKeys blurredPhotoKeys maskedNumber holderHint
  publishedAt expiresAt organisationSlug
  attributes { colours brand marks }
  place { label city radiusM keptAt point { latitude longitude } }
}`;
const READS = {
  listing: `query ($id: ID!) { listing(id: $id) ${EVERYTHING} }`,
  search: `query { searchListings(first: 50, filter: { documentType: "CNI" }) {
    totalCount edges { node ${EVERYTHING} } } }`,
  map: `query { mapListings(bbox: { south: 3, west: 9, north: 5, east: 12 }, zoom: 22) {
    markers { id categoryKey documentType point { latitude longitude } }
    circles { id categoryKey documentType radiusM center { latitude longitude } } } }`,
  mine: `query ($id: ID!) { myListing(id: $id) { id maskedNumber photos { key blurredKey } } }`,
  myListings: `query { myListings { totalCount edges { node { id } } } }`,
};

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
  kit.ocr.answer(fakeCniLines());
});

const post = async (query: string, variables: object, token?: string) => {
  const response = await kit.app.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rouvix-client": "spec",
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return response.text();
};

const media = async (path: string, token?: string) =>
  (
    await kit.app.fetch(
      new Request(`http://localhost/media/${path}`, {
        headers: {
          "x-rouvix-client": "spec",
          ...(token && { authorization: `Bearer ${token}` }),
        },
      }),
    )
  ).status;

// A found CNI declared, processed and public; what its finder knows of it.
async function foundCni() {
  const finder = await listingsAs(kit);
  const key = await photoOf(kit, finder.token);
  const declared = await finder.listings.declare(
    finder.viewer,
    { ...documentContent({ photoKeys: [key] }), kind: "FOUND", publish: true },
    null,
  );
  await kit.auth.background.settled();
  const listing = await finder.listings.find(declared._id.toHexString());
  if (listing === undefined) throw new Error("gone");
  return { id: declared._id.toHexString(), key, listing };
}

// Ids and keys (hex and UUIDs) hold digits by chance: they are taken out
// before a digit sequence of the number is looked for.
const withoutIds = (text: string) =>
  text.replace(
    /[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{24}|\d{4}-\d{2}-\d{2}T[\d:.]+Z/g,
    "_",
  );

function expectNothingRead(
  text: string,
  cni: Awaited<ReturnType<typeof foundCni>>,
) {
  const number = FAKE_CNI.number;
  for (const secret of [
    number,
    number.slice(2),
    "ESSAI",
    "PIERRE",
    "01.01.1990",
    "1990-01-01",
    cni.key,
    cni.listing.idFields as string,
    cni.listing.idNumberHash as string,
    "idFields",
    "idNumberHash",
  ]) {
    expect(text).not.toContain(secret);
  }
  // The last digits, what a claim asks for, appear nowhere.
  expect(withoutIds(text)).not.toContain(number.slice(-4));
}

describe("what is answered of a found ID document", () => {
  test("to a visitor: the masked number, the hint and the blurred copy, nothing read", async () => {
    const cni = await foundCni();
    const blurredKey = cni.listing.photos[0]?.blurredKey as string;
    const one = await post(READS.listing, { id: cni.id });
    expect(one).toContain('"maskedNumber":"99••••••••"');
    expect(one).toContain('"holderHint":"Jean E."');
    expect(one).toContain(blurredKey);
    for (const text of [
      one,
      await post(READS.search, {}),
      await post(READS.map, {}),
    ]) {
      expectNothingRead(text, cni);
    }
    expect(await post(READS.mine, { id: cni.id })).toContain(
      "auth.errors.unauthenticated",
    );
    expect(await media(`listing-photos/${cni.key}/full`)).toBe(404);
    expect(await media(`listing-blurred/${blurredKey}`)).toBe(200);
  });

  test("to another signed-in account, a would-be claimant: the same, and not the finder's view", async () => {
    const cni = await foundCni();
    const other = await signedIn(kit, { phone: fakeE164(2) });
    const answers = [
      await post(READS.listing, { id: cni.id }, other.token),
      await post(READS.search, {}, other.token),
      await post(READS.map, {}, other.token),
      await post(READS.mine, { id: cni.id }, other.token),
      await post(READS.myListings, {}, other.token),
    ];
    for (const text of answers) expectNothingRead(text, cni);
    expect(answers[3]).toContain("listings.errors.listing-not-found");
    expect(answers[4]).toContain('"totalCount":0');
    expect(await media(`listing-photos/${cni.key}/full`, other.token)).toBe(
      404,
    );
  });

  test("to the finder: the photo and what visitors see, never the sealed fields", async () => {
    const cni = await foundCni();
    const finder = await signedIn(kit, { phone: fakeE164(1) });
    const mine = await post(READS.mine, { id: cni.id }, finder.token);
    expect(mine).toContain(cni.key);
    expect(mine).toContain('"maskedNumber":"99••••••••"');
    for (const secret of [
      FAKE_CNI.number,
      "ESSAI",
      cni.listing.idFields as string,
      cni.listing.idNumberHash as string,
    ]) {
      expect(mine).not.toContain(secret);
    }
  });
});
