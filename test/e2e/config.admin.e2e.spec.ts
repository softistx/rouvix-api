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
