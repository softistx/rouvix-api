import {
  type BoundRateLimit,
  bindRateLimit,
  defineRateLimit,
} from "@softistx/redis";
import type { Throttle, ThrottleScope, ThrottleVerdict } from "./throttle";

// What a visitor's reads are held to, per address: 120 a minute, 40 at once.
// A page of the app is one or two reads, a map a few more while it pans.
export const limits = {
  "visitor-read": defineRateLimit({
    name: "visitor-read",
    key: (p: { key: string }) => p.key,
    limit: 120,
    per: 60_000,
    burst: 40,
  }),
};

type Counter = Pick<BoundRateLimit<{ key: string }>, "consume">;

// How long a counting may take before the call goes through uncounted.
const TIMEOUT_MS = 200;
const LOG_EVERY_MS = 60_000;

// The Throttle over `@softistx/redis` rate limits. A visitor's read fails open
// (spec §3: "fail closed for sign-in codes, open elsewhere"): Redis down, slow
// or refusing lets the read through, so a Redis outage never takes the public
// search down with it.
export function redisThrottle(
  counters: Record<ThrottleScope, Counter>,
  options: { log?: (line: string) => void; now?: () => number } = {},
): Throttle {
  const { log = console.error, now = Date.now } = options;
  let loggedAt = Number.NEGATIVE_INFINITY;
  return {
    async take(scope, key): Promise<ThrottleVerdict> {
      try {
        const result = await counters[scope].consume({ key }, 1, {
          timeoutMs: TIMEOUT_MS,
        });
        return {
          allowed: result.allowed,
          retryAfter: Math.ceil(result.retryAfter / 1000),
        };
      } catch (error) {
        // Once a minute at most: an outage must not flood the log.
        if (now() - loggedAt >= LOG_EVERY_MS) {
          loggedAt = now();
          log(
            `throttle open: ${scope} not counted (${error instanceof Error ? error.name : "error"})`,
          );
        }
        return { allowed: true, retryAfter: 0 };
      }
    },
  };
}

// The adapter over a Redis client, the limits bound by hand (no prefix).
export function boundCounters(
  client: Parameters<typeof bindRateLimit>[0],
): Record<ThrottleScope, Counter> {
  return { "visitor-read": bindRateLimit(client, limits["visitor-read"]) };
}
