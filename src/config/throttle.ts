import {
  boundCounters,
  redisThrottle,
  type Throttle,
  unlimited,
} from "@/throttle";
import { redis } from "./redis";

// The server's Throttle: Redis's rate limits where Redis is configured
// (production requires it), nothing counted without it (src/config/redis.ts).
export function serverThrottle(): Throttle {
  return redis === undefined
    ? unlimited
    : redisThrottle(boundCounters(redis.client));
}
