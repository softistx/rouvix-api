import { expect, test } from "bun:test";
import type { RedisClient } from "bun";
import { redisGeocodeCache } from "./redis-cache";

// A Redis that does not answer is a miss and a lost write, never a failure: the
// real client is exercised by the deployment's `/ready` and the dev stack.
test("a Redis that fails reads as a miss and swallows a write", async () => {
  const broken = new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error("redis is down");
      },
    },
  ) as unknown as RedisClient;
  const cache = redisGeocodeCache(broken);
  expect(await cache.get("k")).toBeUndefined();
  await cache.set("k", { results: [] });
});
