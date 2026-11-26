// The Throttle port (spec §3): how many reads an address may make. It is passed
// explicitly, never defaulted: src/app.ts chooses the adapter, a spec gives its
// own. A scope is one budget; a key is who it counts (an address).
export type ThrottleScope = "visitor-read";

export interface ThrottleVerdict {
  allowed: boolean;
  // Whole seconds until the next call would be allowed; 0 when it was.
  retryAfter: number;
}

export interface Throttle {
  // Counts one call of `key` in `scope`.
  take(scope: ThrottleScope, key: string): Promise<ThrottleVerdict>;
}

// Nothing counted: what runs without Redis (development, specs that do not
// throttle).
export const unlimited: Throttle = {
  take: async () => ({ allowed: true, retryAfter: 0 }),
};
