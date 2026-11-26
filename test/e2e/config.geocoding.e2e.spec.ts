import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";

// Countries, categories, safe places and geocoding, through the REAL janus. The
// geocoder is the fake of test/geocoder.ts: no spec reaches a provider.

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

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
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
