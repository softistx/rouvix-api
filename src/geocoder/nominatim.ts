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
  // How many asks may wait for their turn; past it, an ask fails at once (a
  // retryable error) rather than queue behind a backlog. Default 20.
  maxQueued?: number;
  timeoutMs?: number;
  // Injected in specs; Bun's `fetch`, the system clock and `setTimeout` otherwise.
  fetch?: typeof fetch;
  // A monotonic clock in milliseconds (`performance.now` by default).
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

type Sleep = (ms: number) => Promise<void>;

// Runs calls one at a time, each at least `gap` after the last one started,
// and refuses a call when `maxQueued` are already waiting. The clock is
// monotonic and a wait is never longer than `gap`, so a clock that jumps
// cannot stall the queue.
function pacer(options: {
  gap: number;
  maxQueued: number;
  now: () => number;
  sleep: Sleep;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = Number.NEGATIVE_INFINITY;
  let waiting = 0;
  return function paced<T>(call: () => Promise<T>): Promise<T> {
    if (waiting >= options.maxQueued) {
      return Promise.reject(
        new GeocoderError("the geocoding queue is full", true),
      );
    }
    waiting += 1;
    const run = queue.then(async () => {
      waiting -= 1;
      const wait = Math.min(options.gap, lastAt + options.gap - options.now());
      if (wait > 0) await options.sleep(wait);
      lastAt = options.now();
      return call();
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

// One GET to the provider with the application's own User-Agent, its failures
// as `GeocoderError`s.
async function getJson(
  options: NominatimOptions,
  path: string,
  params: Record<string, string>,
) {
  const send = options.fetch ?? fetch;
  const url = `${options.baseUrl}${path}?${new URLSearchParams(params)}`;
  let response: Response;
  try {
    response = await send(url, {
      headers: { "user-agent": options.userAgent, accept: "application/json" },
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

// The Nominatim adapter (OpenStreetMap's public service, under its usage
// policy): one request a second, whatever the callers (requests are queued, in
// this process: the API runs as one instance), the application's own
// User-Agent, and every answer cached, so a repeated ask never reaches the
// provider; identical asks in flight share one request. `fetch`, the clock and
// the sleep are injected so a spec never waits and never calls out.
export function nominatimGeocoder(options: NominatimOptions): Geocoder {
  const paced = pacer({
    gap: options.minIntervalMs ?? 1_000,
    maxQueued: options.maxQueued ?? 20,
    now: options.now ?? (() => performance.now()),
    sleep:
      options.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  });
  const inFlight = new Map<string, Promise<GeocodeResult[]>>();

  async function cached(
    key: string,
    load: () => Promise<GeocodeResult[]>,
  ): Promise<GeocodeResult[]> {
    const hit = await options.cache.get(key);
    if (hit !== undefined) return hit.results;
    const shared = inFlight.get(key);
    if (shared !== undefined) return shared;
    const asked = paced(load)
      .then(async (results) => {
        await options.cache.set(key, { results });
        return results;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, asked);
    return asked;
  }

  return {
    search: (query, { countryCode, limit }) =>
      cached(
        `s:${countryCode ?? "-"}:${limit}:${normalized(query)}`,
        async () => {
          const body = await getJson(options, "/search", {
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
        const body = await getJson(options, "/reverse", {
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
