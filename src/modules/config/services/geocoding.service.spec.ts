import { describe, expect, test } from "bun:test";
import { fakeGeocoder } from "~/geocoder";
import { refusal } from "~/refusals";
import { GeocodingService } from "./geocoding.service";

describe("GeocodingService", () => {
  test("asks the port with the trimmed text, the country and the limit", async () => {
    const geocoder = fakeGeocoder();
    const found = await new GeocodingService(geocoder).search("  akwa ", {
      countryCode: "CM",
      limit: 3,
    });
    expect(found.map((f) => f.city)).toEqual(["Douala"]);
    expect(geocoder.asked).toEqual([{ kind: "search", query: "akwa" }]);
    expect(
      await new GeocodingService(geocoder).search("akwa", {
        countryCode: "FR",
        limit: 3,
      }),
    ).toEqual([]);
  });

  test("a query of spaces asks the provider nothing", async () => {
    const geocoder = fakeGeocoder();
    expect(
      await new GeocodingService(geocoder).search("   ", { limit: 3 }),
    ).toEqual([]);
    expect(geocoder.asked).toEqual([]);
  });

  test("reads the place at a point", async () => {
    const found = await new GeocodingService(fakeGeocoder()).reverse({
      latitude: 4.05,
      longitude: 9.7,
    });
    expect(found?.countryCode).toBe("CM");
  });

  test("a provider that fails is the 503 geocoding-unavailable, in both directions", async () => {
    const geocoder = fakeGeocoder();
    geocoder.fail();
    const service = new GeocodingService(geocoder);
    const search = await refusal(service.search("akwa", { limit: 1 }));
    expect(search.extensions["code"]).toBe(
      "config.errors.geocoding-unavailable",
    );
    expect(search.extensions["http"]).toEqual({ status: 503 });
    const reverse = await refusal(
      service.reverse({ latitude: 0, longitude: 0 }),
    );
    expect(reverse.extensions["code"]).toBe(
      "config.errors.geocoding-unavailable",
    );
  });
});
