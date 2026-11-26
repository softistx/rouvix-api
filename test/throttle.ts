import type { Throttle, ThrottleScope } from "@/throttle";

// A Throttle for specs: `limit` calls per key and scope, then refused with
// `retryAfter` seconds; it keeps the keys it counted.
export function memoryThrottle(limit: number, retryAfter = 60) {
  const counts = new Map<string, number>();
  const throttle: Throttle & { keys: () => string[] } = {
    async take(scope: ThrottleScope, key: string) {
      const id = `${scope}:${key}`;
      const n = (counts.get(id) ?? 0) + 1;
      counts.set(id, n);
      return n <= limit
        ? { allowed: true, retryAfter: 0 }
        : { allowed: false, retryAfter };
    },
    keys: () => [...counts.keys()],
  };
  return throttle;
}
