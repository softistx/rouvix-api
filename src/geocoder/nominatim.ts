import type {
  GeocodeCache,
  GeocodePoint,
  GeocodeResult,
  Geocoder,
} from "./geocoder";
import { GeocoderError } from "./geocoder";

export interface NominatimOptions {
  // `https://nominatim.openstreetmap.org`, or a self-hosted instance.
  baseUrl: string;
  // Required by the usage policy: it identifies the application and a contact.
  userAgent: string;
  cache: GeocodeCache;
  // The usage policy allows one request a second.
  minIntervalMs?: number;
  timeoutMs?: number;
  // Injected in specs; Bun's `fetch`, the system clock and `setTimeout` otherwise.
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string>;
}

const CITY_KEYS = ["city", "town", "village", "municipality", "county"];

const normalized = (query: string) =>
  query.trim().toLowerCase().replace(/\s+/g, " ");
// A point rounded to 4 decimals (about 11 m): near-identical asks share a cache
// entry, and the cache holds no exact position.
const rounded = (point: GeocodePoint) =>
  `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;

export function resultOf(place: NominatimPlace): GeocodeResult | null {
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const address = place.address ?? {};
  const city = CITY_KEYS.map((key) => address[key]).find(
    (value) => value !== undefined,
  );
  const country = address["country_code"];
  return {
    label: place.display_name ?? "",
    point: { latitude, longitude },
    city: city ?? null,
    countryCode: country === undefined ? null : country.toUpperCase(),
  };
}

// The Nominatim adapter (OpenStreetMap's public service, under its usage
// policy): one request a second, whatever the callers (requests are queued, in
// this process: the API runs as one instance), the application's own
// User-Agent, and every answer cached, so a repeated ask never reaches the
// provider. `fetch`, the clock and the sleep are injected so a spec never
// waits and never calls out.
export function nominatimGeocoder(options: NominatimOptions): Geocoder {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = options.minIntervalMs ?? 1_000;
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = Number.NEGATIVE_INFINITY;

  // Runs `call` after every earlier one, at least `gap` after the last start.
  function paced<T>(call: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = lastAt + gap - now();
      if (wait > 0) await sleep(wait);
      lastAt = now();
      return call();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function get(path: string, params: Record<string, string>) {
    const url = `${options.baseUrl}${path}?${new URLSearchParams(params)}`;
    let response: Response;
    try {
      response = await send(url, {
        headers: {
          "user-agent": options.userAgent,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch (cause) {
      throw new GeocoderError("Nominatim did not answer", true, { cause });
    }
    if (!response.ok) {
      throw new GeocoderError(
        `Nominatim answered ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch (cause) {
      throw new GeocoderError("Nominatim answered no JSON", true, { cause });
    }
  }

  async function cached(
    key: string,
    load: () => Promise<GeocodeResult[]>,
  ): Promise<GeocodeResult[]> {
    const hit = await options.cache.get(key);
    if (hit !== undefined) return hit.results;
    const results = await paced(load);
    await options.cache.set(key, { results });
    return results;
  }

  return {
    search: (query, { countryCode, limit }) =>
      cached(
        `s:${countryCode ?? "-"}:${limit}:${normalized(query)}`,
        async () => {
          const body = await get("/search", {
            q: query,
            format: "jsonv2",
            addressdetails: "1",
            limit: String(limit),
            ...(countryCode && { countrycodes: countryCode.toLowerCase() }),
          });
          if (!Array.isArray(body)) {
            throw new GeocoderError(
              "Nominatim answered an unexpected body",
              true,
            );
          }
          return (body as NominatimPlace[]).flatMap((place) => {
            const result = resultOf(place);
            return result === null ? [] : [result];
          });
        },
      ),
    reverse: async (point) => {
      const [found] = await cached(`r:${rounded(point)}`, async () => {
        const body = await get("/reverse", {
          lat: String(point.latitude),
          lon: String(point.longitude),
          format: "jsonv2",
          addressdetails: "1",
          zoom: "18",
        });
        // Nominatim answers `{ error: "Unable to geocode" }` where it knows nothing.
        const result =
          typeof body === "object" && body !== null && !("error" in body)
            ? resultOf(body as NominatimPlace)
            : null;
        return result === null ? [] : [result];
      });
      return found ?? null;
    },
  };
}
