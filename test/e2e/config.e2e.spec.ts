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

const GEOCODE_QUERY = graphql(`
  query GeocodeQuery($query: String!, $countryCode: String) {
    geocode(query: $query, countryCode: $countryCode) {
      label
      city
      countryCode
      point { latitude longitude }
    }
  }
`);

const REVERSE_GEOCODE_QUERY = graphql(`
  query ReverseGeocodeQuery($point: GeoPointInput!) {
    reverseGeocode(point: $point) {
      label
      city
    }
  }
`);

const SET_COUNTRY_MUTATION = graphql(`
  mutation SetCountry($input: CountryInput!) {
    setCountry(input: $input) {
      code
      name
      active
    }
  }
`);

const SET_CATEGORY_MUTATION = graphql(`
  mutation SetCategory($input: CategoryInput!) {
    setCategory(input: $input) {
      key
      label
      parent
    }
  }
`);

const CREATE_SAFE_PLACE_MUTATION = graphql(`
  mutation CreateSafePlace($input: SafePlaceInput!) {
    createSafePlace(input: $input) {
      id
      name
      version
    }
  }
`);

const UPDATE_SAFE_PLACE_MUTATION = graphql(`
  mutation UpdateSafePlace($id: ID!, $input: SafePlaceInput!, $version: Int) {
    updateSafePlace(id: $id, input: $input, version: $version) {
      name
      hours
      version
    }
  }
`);

const DELETE_SAFE_PLACE_MUTATION = graphql(`
  mutation DeleteSafePlace($id: ID!) {
    deleteSafePlace(id: $id)
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

const place = {
  countryCode: "CM",
  city: "Douala",
  name: "Poste de test",
  kind: "POLICE" as const,
  location: { latitude: 4.06, longitude: 9.71 },
  hours: "24h/24",
};

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

describe("the platform admin edits the configuration", () => {
  test("sets a country and a category, a safe place created, updated with its version, then archived", async () => {
    const owner = await admin();
    const as = kit.client(owner.token);
    const country = await as.query(SET_COUNTRY_MUTATION, {
      variables: {
        input: {
          code: "GA",
          names: { fr: "Gabon", en: "Gabon" },
          dialCode: "+241",
          phonePattern: "^\\+241\\d{8}$",
          documentTypes: ["CNI"],
          languages: ["FR"],
          mapCenter: { latitude: -0.8, longitude: 11.6 },
          mapZoom: 6,
          idNumberPatterns: [{ documentType: "CNI", pattern: "^\\d{8}$" }],
        },
      },
    });
    expect(country.data?.setCountry).toEqual({
      code: "GA",
      name: "Gabon",
      active: true,
    });
    const category = await as.query(SET_CATEGORY_MUTATION, {
      variables: {
        input: {
          key: "BICYCLE",
          labels: { fr: "Vélos", en: "Bicycles" },
          parent: null,
          isDocument: false,
          order: 20,
        },
      },
    });
    expect(category.data?.setCategory).toEqual({
      key: "BICYCLE",
      label: "Vélos",
      parent: null,
    });

    const created = await as.query(CREATE_SAFE_PLACE_MUTATION, {
      variables: { input: place },
    });
    const made = created.data?.createSafePlace;
    expect(made?.version).toBe(0);
    const updated = await as.query(UPDATE_SAFE_PLACE_MUTATION, {
      variables: {
        id: made?.id as string,
        input: { ...place, name: "Renommé" },
        version: 0,
      },
    });
    expect(updated.data?.updateSafePlace).toMatchObject({
      name: "Renommé",
      hours: "24h/24",
    });
    const stale = await as.query(UPDATE_SAFE_PLACE_MUTATION, {
      variables: { id: made?.id as string, input: place, version: 0 },
    });
    expect(codeOf(stale)).toBe("config.errors.stale-version");
    expect(stale.status).toBe(409);
    const removed = await as.query(DELETE_SAFE_PLACE_MUTATION, {
      variables: { id: made?.id as string },
    });
    expect(removed.data?.deleteSafePlace).toBe(made?.id as string);
    const gone = await as.query(DELETE_SAFE_PLACE_MUTATION, {
      variables: { id: made?.id as string },
    });
    expect(codeOf(gone)).toBe("config.errors.safe-place-not-found");
    expect(
      (await kit.client().query(COUNTRIES_QUERY)).data?.countries.map(
        (c) => c.code,
      ),
    ).toEqual(["CM", "GA"]);
  });

  test("a bad input is one invalid-input with its issues, an unknown country its own code", async () => {
    const as = kit.client((await admin()).token);
    const bad = await as.query(SET_COUNTRY_MUTATION, {
      variables: {
        input: {
          code: "GA",
          names: { fr: "Gabon", en: "Gabon" },
          dialCode: "+241",
          phonePattern: "(",
          documentTypes: ["NOPE"],
          languages: ["FR"],
          mapCenter: { latitude: 0, longitude: 0 },
          mapZoom: 6,
          idNumberPatterns: [],
        },
      },
    });
    expect(codeOf(bad)).toBe("validation.errors.invalid-input");
    const fields = bad.errors?.[0]?.extensions?.["fields"] as {
      path: string;
      code: string;
    }[];
    expect(fields.map((f) => f.path).sort()).toEqual([
      "documentTypes.0",
      "phonePattern",
    ]);
    const place400 = await as.query(CREATE_SAFE_PLACE_MUTATION, {
      variables: { input: { ...place, countryCode: "ZZ" } },
    });
    expect(codeOf(place400)).toBe("config.errors.country-not-found");
    expect(place400.status).toBe(400);
  });
});

describe("who may edit", () => {
  test("a visitor is 401, a plain account and a moderator 403, a suspended admin passes nothing", async () => {
    const createPlace = (token?: string | null) =>
      kit
        .client(token)
        .query(CREATE_SAFE_PLACE_MUTATION, { variables: { input: place } });
    expect(codeOf(await createPlace())).toBe("auth.errors.unauthenticated");
    const user = await signedIn(kit, { phone: fakeE164(2) });
    expect(codeOf(await createPlace(user.token))).toBe("auth.errors.forbidden");
    const moderator = await signedIn(kit, { phone: fakeE164(3) });
    await kit.auth.permissions.grant(PLATFORM, "moderators", {
      type: "user",
      id: moderator.account.id,
    });
    expect(codeOf(await createPlace(moderator.token))).toBe(
      "auth.errors.forbidden",
    );
    const owner = await admin();
    await kit.auth.accounts.update(owner.account, {
      suspendedAt: "2026-11-26T10:00:00.000Z",
    });
    expect(codeOf(await createPlace(owner.token))).toBe(
      "accounts.errors.suspended",
    );
    const country = await kit.client(user.token).query(SET_COUNTRY_MUTATION, {
      variables: {
        input: {
          code: "GA",
          names: { fr: "G", en: "G" },
          dialCode: "+241",
          phonePattern: "x",
          documentTypes: [],
          languages: ["FR"],
          mapCenter: { latitude: 0, longitude: 0 },
          mapZoom: 6,
          idNumberPatterns: [],
        },
      },
    });
    expect(codeOf(country)).toBe("auth.errors.forbidden");
    expect(
      await kit
        .client()
        .query(COUNTRIES_QUERY)
        .then((r) => r.data?.countries.length),
    ).toBe(1);
  });
});

describe("geocoding", () => {
  test("needs a signed-in account, and answers from the port, never a real provider", async () => {
    const anonymous = await kit
      .client()
      .query(GEOCODE_QUERY, { variables: { query: "akwa" } });
    expect(codeOf(anonymous)).toBe("auth.errors.unauthenticated");
    expect(kit.geocoder.asked).toEqual([]);
    const { token } = await signedIn(kit);
    const found = await kit.client(token).query(GEOCODE_QUERY, {
      variables: { query: "akwa", countryCode: "CM" },
    });
    expect(found.data?.geocode).toEqual([
      {
        label: "Akwa, Douala, Littoral, Cameroun",
        city: "Douala",
        countryCode: "CM",
        point: { latitude: 4.0511, longitude: 9.7043 },
      },
    ]);
    const reverse = await kit.client(token).query(REVERSE_GEOCODE_QUERY, {
      variables: { point: { latitude: 4.05, longitude: 9.7 } },
    });
    expect(reverse.data?.reverseGeocode?.city).toBe("Douala");
  });

  test("a provider that is down is a 503, and the other operations still work", async () => {
    const { token } = await signedIn(kit);
    kit.geocoder.fail();
    const down = await kit
      .client(token)
      .query(GEOCODE_QUERY, { variables: { query: "akwa" } });
    expect(codeOf(down)).toBe("config.errors.geocoding-unavailable");
    expect(down.status).toBe(503);
    expect((await kit.client().query(COUNTRIES_QUERY)).errors).toBeUndefined();
  });

  test("a query under two characters is refused before the provider is asked", async () => {
    const { token } = await signedIn(kit);
    const short = await kit
      .client(token)
      .query(GEOCODE_QUERY, { variables: { query: "a" } });
    expect(codeOf(short)).toBe("validation.errors.invalid-input");
    expect(kit.geocoder.asked).toEqual([]);
  });
});
