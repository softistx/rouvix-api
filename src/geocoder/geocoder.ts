// The port to the geocoding provider: place search and reverse geocoding for
// the declare form and the map (spec §3). A module takes it as a required
// parameter, passed by the registry, never defaulted but at the app's entry
// point (`createApp`); specs pass the fake of test/geocoder.ts and never reach
// a real provider.
export interface GeocodePoint {
  latitude: number;
  longitude: number;
}

export interface GeocodeResult {
  // The provider's display name of the place, one line.
  label: string;
  point: GeocodePoint;
  // The city, town or village, when the provider names one.
  city: string | null;
  // ISO 3166-1 alpha-2, upper case, when the provider names one.
  countryCode: string | null;
}

export interface Geocoder {
  search(
    query: string,
    options: { countryCode?: string | undefined; limit: number },
  ): Promise<GeocodeResult[]>;
  // The place at a point, or null where the provider knows none.
  reverse(point: GeocodePoint): Promise<GeocodeResult | null>;
}

// The provider refused or did not answer. `retryable` says whether trying
// again can work (a timeout, a 5xx, a 429), as opposed to a refused request.
export class GeocoderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GeocoderError";
  }
}

// What an adapter keeps between two identical asks, so the provider's usage
// policy (one request a second, results cached) holds. The server's is Redis
// (`redisGeocodeCache`), a spec's the memory one.
export interface GeocodeCache {
  get(key: string): Promise<GeocodeCacheEntry | undefined>;
  set(key: string, entry: GeocodeCacheEntry): Promise<void>;
}

// A search answers a list, a reverse a place or none: `null` is kept too, so
// a point with no place is not asked again.
export type GeocodeCacheEntry = { results: GeocodeResult[] };

export function memoryGeocodeCache(): GeocodeCache & { size: () => number } {
  const kept = new Map<string, GeocodeCacheEntry>();
  return {
    size: () => kept.size,
    get: async (key) => kept.get(key),
    set: async (key, entry) => {
      kept.set(key, entry);
    },
  };
}
