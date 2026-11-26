import { bindCache, defineCache } from "@softistx/redis";
import type { RedisClient } from "bun";
import { z } from "zod";
import type { GeocodeCache } from "./geocoder";

const geocodeEntry = defineCache({
  name: "geocode",
  key: (key: string) => key,
  // 30 days: the provider's policy allows keeping results, and a place's
  // coordinates hardly move.
  ttl: 30 * 24 * 3600,
  schema: z.object({
    results: z.array(
      z.object({
        label: z.string(),
        point: z.object({ latitude: z.number(), longitude: z.number() }),
        city: z.string().nullable(),
        countryCode: z.string().nullable(),
      }),
    ),
  }),
});

// The server's geocode cache: Redis, through @softistx/redis' bound cache. A
// Redis that does not answer is a miss, never a failure: geocoding then
// reaches the provider, still at one request a second.
export function redisGeocodeCache(client: RedisClient): GeocodeCache {
  const bound = bindCache(client, geocodeEntry);
  return {
    get: (key) => bound.get(key).catch(() => undefined),
    set: (key, entry) => bound.set(key, entry).catch(() => undefined),
  };
}
