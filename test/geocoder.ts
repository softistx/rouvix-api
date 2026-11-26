import {
  type GeocodePoint,
  type GeocodeResult,
  type Geocoder,
  GeocoderError,
} from "@/geocoder";

// A Geocoder for specs: it answers from a list it was given, records what it
// was asked, and never reaches a provider. `fail()` makes the next calls throw
// the provider's error.
export function fakeGeocoder(
  places: readonly GeocodeResult[] = [
    {
      label: "Akwa, Douala, Littoral, Cameroun",
      point: { latitude: 4.0511, longitude: 9.7043 },
      city: "Douala",
      countryCode: "CM",
    },
    {
      label: "Bastos, Yaoundé, Centre, Cameroun",
      point: { latitude: 3.8967, longitude: 11.5167 },
      city: "Yaoundé",
      countryCode: "CM",
    },
  ],
) {
  const asked: { kind: "search" | "reverse"; query: string }[] = [];
  let failing = false;
  const down = () => {
    if (failing) throw new GeocoderError("fake provider is down", true);
  };
  const geocoder: Geocoder = {
    async search(query, { countryCode, limit }) {
      asked.push({ kind: "search", query });
      down();
      return places
        .filter(
          (place) =>
            place.label.toLowerCase().includes(query.toLowerCase()) &&
            (countryCode === undefined || place.countryCode === countryCode),
        )
        .slice(0, limit);
    },
    async reverse(point: GeocodePoint) {
      asked.push({
        kind: "reverse",
        query: `${point.latitude},${point.longitude}`,
      });
      down();
      return places[0] ?? null;
    },
  };
  return {
    ...geocoder,
    asked,
    fail: (value = true) => {
      failing = value;
    },
  };
}
