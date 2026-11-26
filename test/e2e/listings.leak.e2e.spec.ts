import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { foundContent, listingsAs, lostContent, photoOf } from "~/listings";

// The leak spec, at run time: what a visitor's request for a listing returns,
// as text, holds none of what the author gave in private (spec §8).

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const EVERYTHING = `{
  id kind categoryKey countryCode documentType title description date status
  photoKeys publishedAt expiresAt organisationSlug
  attributes { colours brand marks }
  place { label radiusM keptAt point { latitude longitude } }
}`;

const visitorReads = async (id: string) => {
  const response = await kit.app.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rouvix-client": "spec",
      },
      body: JSON.stringify({ query: `{ listing(id: "${id}") ${EVERYTHING} }` }),
    }),
  );
  return response.text();
};

describe("the masked view", () => {
  test("a found item kept with its finder: no author, no exact point, no question or answer, no phone", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const content = foundContent({
      photoKeys: [key],
      questions: [
        { prompt: "Quel objet est cousu à l'intérieur ?", answer: "Zébulon7" },
      ],
    });
    const declared = await me.listings.declare(
      me.viewer,
      { ...content, kind: "FOUND", publish: true },
      null,
    );
    await kit.auth.background.settled();
    const text = await visitorReads(declared._id.toHexString());
    expect(text).toContain("Portefeuille brun trouvé");
    expect(text).toContain(key);
    for (const secret of [
      me.viewer.id,
      "600000001",
      "+237",
      "3.84812",
      "11.50234",
      "Zébulon7",
      "cousu",
      "authorId",
      "answer",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("3.848");
    expect(text).toContain("11.502");
  });

  test("a lost item is a blurred centre and a radius, never the exact point", async () => {
    const me = await listingsAs(kit);
    const declared = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST", publish: true },
      null,
    );
    const text = await visitorReads(declared._id.toHexString());
    expect(text).toContain('"radiusM":500');
    expect(text).not.toContain("4.05123");
    expect(text).not.toContain("9.70456");
    expect(text).not.toContain(me.viewer.id);
  });

  test("an ID document: no free text, no attribute, no photo, whatever its author wrote", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    const content = lostContent({
      categoryKey: "DOCUMENT",
      documentType: "CNI",
      title: "CNI de Personne Imaginaire",
      description: "Numéro 000000000, né à Nulle Part",
      attributes: { colours: ["bleu"], brand: "Marque", marks: "tache" },
      photoKeys: [key],
    });
    const declared = await me.listings.declare(
      me.viewer,
      { ...content, kind: "LOST", publish: true },
      null,
    );
    const [id] = [declared._id.toHexString()];
    // The photo stays pending, so the listing is not even public yet...
    expect(await visitorReads(id)).toContain(
      "listings.errors.listing-not-found",
    );
    // ...and once it is (no photo), the text is still withheld.
    const bare = await me.listings.declare(
      me.viewer,
      { ...content, photoKeys: [], kind: "LOST", publish: true },
      null,
    );
    const text = await visitorReads(bare._id.toHexString());
    expect(text).toContain('"documentType":"CNI"');
    expect(text).toContain('"title":null');
    expect(text).toContain('"description":null');
    expect(text).toContain('"attributes":null');
    expect(text).toContain('"photoKeys":[]');
    for (const secret of [
      "Personne Imaginaire",
      "000000000",
      "Nulle Part",
      "tache",
      key,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  test("a draft, a pending, a closed and a removed listing are not found", async () => {
    const me = await listingsAs(kit);
    const draft = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST" },
      null,
    );
    const closed = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST", publish: true },
      null,
    );
    await me.listings.close(me.viewer, closed._id.toHexString(), "OTHER");
    const removed = await me.listings.declare(
      me.viewer,
      { ...lostContent(), kind: "LOST", publish: true },
      null,
    );
    await me.listings.remove(me.viewer, removed._id.toHexString());
    for (const listing of [draft, closed, removed]) {
      expect(await visitorReads(listing._id.toHexString())).toContain(
        "listings.errors.listing-not-found",
      );
    }
  });
});
