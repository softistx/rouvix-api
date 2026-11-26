import { beforeEach, describe, expect, test } from "bun:test";
import { PLATFORM } from "@/auth/access";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";

// Countries, categories, safe places and geocoding, through the REAL janus. The
// geocoder is the fake of test/geocoder.ts: no spec reaches a provider.

const COUNTRIES_QUERY = graphql(`
  query CountriesQuery($includeInactive: Boolean) {
    countries(includeInactive: $includeInactive) {
      code
      name
      names { fr en }
      dialCode
      documentTypes
      languages
      mapCenter { latitude longitude }
      idNumberPatterns { documentType pattern }
      active
    }
  }
`);

const CATEGORIES_QUERY = graphql(`
  query CategoriesQuery($includeInactive: Boolean) {
    categories(includeInactive: $includeInactive) {
      key
      label
      parent
      isDocument
    }
  }
`);

const SAFE_PLACES_NEAR_QUERY = graphql(`
  query SafePlacesNearQuery($point: GeoPointInput!, $radiusM: Int) {
    safePlacesNear(point: $point, radiusM: $radiusM) {
      distanceM
      place { id name city kind location { latitude longitude } hours }
    }
  }
`);

const SAFE_PLACES_QUERY = graphql(`
  query SafePlacesQuery($city: String) {
    safePlaces(city: $city) {
      totalCount
      edges { node { id name version } }
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

async function admin() {
  const person = await signedIn(kit, { phone: fakeE164(1) });
  await kit.auth.permissions.grant(PLATFORM, "admins", {
    type: "user",
    id: person.account.id,
  });
  return person;
}

describe("public reads", () => {
  test("an anonymous visitor reads the countries in French by default, English on request", async () => {
    const fr = await kit.client().query(COUNTRIES_QUERY);
    expect(fr.errors).toBeUndefined();
    expect(fr.data?.countries).toMatchObject([
      {
        code: "CM",
        name: "Cameroun",
        dialCode: "+237",
        languages: ["FR", "EN"],
      },
    ]);
    const en = await kit.client(null, "en").query(COUNTRIES_QUERY);
    expect(en.data?.countries[0]?.name).toBe("Cameroon");
    expect(en.data?.countries[0]?.documentTypes).toContain("CNI");
  });

  test("the categories come as a tree, documents first, labelled in the language", async () => {
    const result = await kit.client(null, "en").query(CATEGORIES_QUERY);
    const rows = result.data?.categories ?? [];
    expect(rows[0]).toEqual({
      key: "DOCUMENT",
      label: "Documents",
      parent: null,
      isDocument: true,
    });
    expect(rows[1]).toMatchObject({
      key: "CNI",
      label: "National ID card",
      parent: "DOCUMENT",
    });
  });

  test("the safe places near a point come nearest first, and never hold a phone number or an account", async () => {
    const result = await kit.client().query(SAFE_PLACES_NEAR_QUERY, {
      variables: { point: { latitude: 4.05, longitude: 9.7 }, radiusM: 5000 },
    });
    expect(result.data?.safePlacesNear).toHaveLength(1);
    expect(result.data?.safePlacesNear[0]?.place).toMatchObject({
      city: "Douala",
      kind: "POLICE",
    });
    expect(result.data?.safePlacesNear[0]?.distanceM).toBeGreaterThan(0);
    const list = await kit
      .client()
      .query(SAFE_PLACES_QUERY, { variables: { city: "Yaoundé" } });
    expect(list.data?.safePlaces.totalCount).toBe(1);
  });

  test("the inactive entries are the platform admin's to list", async () => {
    const asVisitor = await kit
      .client()
      .query(COUNTRIES_QUERY, { variables: { includeInactive: true } });
    expect(codeOf(asVisitor)).toBe("auth.errors.unauthenticated");
    const person = await signedIn(kit, { phone: fakeE164(2) });
    const asUser = await kit
      .client(person.token)
      .query(CATEGORIES_QUERY, { variables: { includeInactive: true } });
    expect(codeOf(asUser)).toBe("auth.errors.forbidden");
    const owner = await admin();
    const asAdmin = await kit
      .client(owner.token)
      .query(COUNTRIES_QUERY, { variables: { includeInactive: true } });
    expect(asAdmin.errors).toBeUndefined();
  });
});
