import { describe, expect, test } from "bun:test";
import { distanceM, fromGeoJson, labelIn, toGeoJson } from "./config.utils";

describe("labelIn", () => {
  test("is the language's text, French for any other", () => {
    const texts = { fr: "Cameroun", en: "Cameroon" };
    expect(labelIn(texts, "en")).toBe("Cameroon");
    expect(labelIn(texts, "fr")).toBe("Cameroun");
    expect(labelIn(texts, "de")).toBe("Cameroun");
  });
});

describe("GeoJSON", () => {
  test("stores longitude first and reads it back", () => {
    const point = { latitude: 4.05, longitude: 9.7 };
    expect(toGeoJson(point)).toEqual({
      type: "Point",
      coordinates: [9.7, 4.05],
    });
    expect(fromGeoJson(toGeoJson(point))).toEqual(point);
  });
});

describe("distanceM", () => {
  test("is zero at the same point and symmetric", () => {
    const a = { latitude: 4.0511, longitude: 9.7043 };
    const b = { latitude: 3.848, longitude: 11.5021 };
    expect(distanceM(a, a)).toBe(0);
    expect(distanceM(a, b)).toBe(distanceM(b, a));
  });

  test("Douala to Yaoundé is about 200 km, 111 km per degree of latitude", () => {
    const douala = { latitude: 4.0511, longitude: 9.7043 };
    const yaounde = { latitude: 3.848, longitude: 11.5021 };
    expect(distanceM(douala, yaounde)).toBeGreaterThan(190_000);
    expect(distanceM(douala, yaounde)).toBeLessThan(210_000);
    expect(
      distanceM({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeGreaterThan(111_000);
  });
});
