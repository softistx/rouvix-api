import type { LocalizedText } from "./models";

// The text in the request's language, else French (the fallback), else English.
export const labelIn = (texts: LocalizedText, language: string): string =>
  language === "en" ? texts.en : texts.fr;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

// A GeoJSON point, `[longitude, latitude]`, as `safePlaces.location` stores it.
export const toGeoJson = ({ latitude, longitude }: GeoPoint) => ({
  type: "Point" as const,
  coordinates: [longitude, latitude] as [number, number],
});

export const fromGeoJson = (point: {
  coordinates: readonly [number, number];
}): GeoPoint => ({
  latitude: point.coordinates[1],
  longitude: point.coordinates[0],
});

const EARTH_RADIUS_M = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

// The great-circle distance between two points, in whole metres (haversine).
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}
