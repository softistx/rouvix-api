import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { foundContent, listingsAs, lostContent, photoOf } from "~/listings";
import { publishFound, publishLost } from "~/search";

// The leak spec of search, at run time (spec §8): what a visitor's search and
// map answer, as text, holds none of what the author gave in private. The
// requests are plain HTTP, as the BFF sends them.

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const NODE = `{
  id kind categoryKey countryCode documentType title description date status
  photoKeys publishedAt expiresAt organisationSlug
  attributes { colours brand marks }
  place { label city radiusM keptAt point { latitude longitude } }
}`;
const SEARCH = `query ($filter: ListingFilter) {
  searchListings(first: 50, filter: $filter) {
    totalCount
    counts { kinds { kind count } categories { categoryKey count } }
    edges { distanceM node ${NODE} }
  }
}`;
const MAP = `query ($bbox: BoundingBoxInput!, $filter: ListingFilter) {
  mapListings(bbox: $bbox, filter: $filter, zoom: 22) {
    truncated
    markers { id categoryKey documentType point { latitude longitude } }
    clusters { count point { latitude longitude } bounds { south west north east } }
    circles { id categoryKey documentType radiusM center { latitude longitude } }
  }
}`;
const bbox = { south: 3.5, west: 9, north: 4.5, east: 12 };

const asVisitor = async (query: string, variables: object = {}) => {
  const response = await kit.app.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rouvix-client": "spec",
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return response.text();
};

describe("what a visitor's search and map answer", () => {
  test("a found item kept with its finder: no author, no exact point, no question, no label", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    await publishFound(me, {
      photoKeys: [key],
      questions: [{ prompt: "Quel objet est cousu ?", answer: "Zébulon7" }],
    });
    await kit.auth.background.settled();
    for (const text of [
      await asVisitor(SEARCH),
      await asVisitor(MAP, { bbox }),
    ]) {
      for (const secret of [
        me.viewer.id,
        "600000001",
        "+237",
        "3.84812",
        "11.50234",
        "Zébulon7",
        "cousu",
        "authorId",
        "Jardin de test",
      ]) {
        expect(text).not.toContain(secret);
      }
    }
    const searched = await asVisitor(SEARCH);
    expect(searched).toContain("Portefeuille brun trouvé");
    expect(searched).toContain('"label":null');
    expect(searched).toContain("3.848");
    expect(searched).toContain("11.502");
  });

  test("a lost item is a blurred centre and a radius, in the list and on the map", async () => {
    const me = await listingsAs(kit);
    await publishLost(me);
    for (const text of [
      await asVisitor(SEARCH),
      await asVisitor(MAP, { bbox }),
    ]) {
      expect(text).toContain('"radiusM":500');
      for (const secret of ["4.05123", "9.70456", me.viewer.id]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  test("an ID document is found by its type: its text is never matched, listed or counted by", async () => {
    const me = await listingsAs(kit);
    const key = await photoOf(kit, me.token);
    await publishLost(me, {
      categoryKey: "DOCUMENT",
      documentType: "CNI",
      title: "CNI de Personne Imaginaire",
      description: "Numéro 000000000, né à Nulle Part",
      attributes: { colours: ["bleu"], brand: "Marque", marks: "tache" },
      photoKeys: [key],
      place: { ...lostContent().place, city: "Marie Ngono" },
    });
    for (const text of [
      "Imaginaire",
      "000000000",
      "Nulle",
      "tache",
      "Marque",
      "bleu",
    ]) {
      const found = await asVisitor(SEARCH, { filter: { text } });
      expect(found).toContain('"totalCount":0');
    }
    // Its town could be its holder's name: not returned, not filterable.
    expect(
      await asVisitor(SEARCH, { filter: { city: "Marie Ngono" } }),
    ).toContain('"totalCount":0');
    const byType = await asVisitor(SEARCH, { filter: { documentType: "CNI" } });
    expect(byType).toContain('"city":null');
    expect(byType).not.toContain("Ngono");
    expect(byType).toContain('"totalCount":1');
    expect(byType).toContain('"title":null');
    expect(byType).toContain('"photoKeys":[]');
    for (const secret of [
      "Personne Imaginaire",
      "000000000",
      "Nulle Part",
      "tache",
      "Marché de test",
      key,
    ]) {
      expect(byType).not.toContain(secret);
      expect(await asVisitor(MAP, { bbox })).not.toContain(secret);
    }
  });

  test("a place label is no search text; a draft, a closed and a removed listing are nowhere", async () => {
    const me = await listingsAs(kit);
    await publishLost(me, {
      title: "Visible",
      place: { ...lostContent().place, label: "Impasse Secrète" },
    });
    await me.listings.declare(
      me.viewer,
      { ...foundContent({ title: "Brouillon privé" }), kind: "FOUND" },
      null,
    );
    const closed = await publishFound(me, { title: "Clos privé" });
    await me.listings.close(me.viewer, closed._id.toHexString(), "OTHER");
    const removed = await publishFound(me, { title: "Retiré privé" });
    await me.listings.remove(me.viewer, removed._id.toHexString());
    expect(await asVisitor(SEARCH, { filter: { text: "Secrète" } })).toContain(
      '"totalCount":0',
    );
    const all = await asVisitor(SEARCH);
    const onMap = await asVisitor(MAP, { bbox });
    for (const hidden of ["Brouillon", "Clos", "Retiré"]) {
      expect(all).not.toContain(hidden);
      expect(onMap).not.toContain(hidden);
    }
    expect(all).toContain('"totalCount":1');
  });
});
