import type { Geocoder } from "@/geocoder";
import {
  memoryGeocodeCache,
  nominatimGeocoder,
  redisGeocodeCache,
} from "@/geocoder";
import { env } from "./env";
import { redis } from "./redis";

// The server's geocoder: Nominatim under its usage policy, cached in Redis
// where it is configured, else in memory (lost at restart, still one request
// a second).
export function serverGeocoder(): Geocoder {
  return nominatimGeocoder({
    baseUrl: env.GEOCODER_URL,
    userAgent: env.GEOCODER_USER_AGENT,
    cache: redis ? redisGeocodeCache(redis.client) : memoryGeocodeCache(),
  });
}
