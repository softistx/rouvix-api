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

const CREATE_SAFE_PLACE_MUTATION = graphql(`
  mutation CreateSafePlace($input: SafePlaceInput!) {
    createSafePlace(input: $input) {
      id
      name
      version
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

const place = {
  countryCode: "CM",
  city: "Douala",
  name: "Poste de test",
  kind: "POLICE" as const,
  location: { latitude: 4.06, longitude: 9.71 },
  hours: "24h/24",
};

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
