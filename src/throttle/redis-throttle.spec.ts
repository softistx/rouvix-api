import { describe, expect, test } from "bun:test";
import { GuardError } from "@softistx/redis";
import { limits, redisThrottle } from "./redis-throttle";

const verdictOf = (result: object | Error) =>
  redisThrottle({
    "visitor-read": {
      consume: async () => {
        if (result instanceof Error) throw result;
        return result as never;
      },
    },
  }).take("visitor-read", "203.0.113.7");

const spent = {
  allowed: false,
  limit: 40,
  remaining: 0,
  resetAfter: 5_000,
  retryAfter: 1_200,
};

describe("redisThrottle", () => {
  test("counts the key it is given, once, with a deadline", async () => {
    const calls: unknown[][] = [];
    await redisThrottle({
      "visitor-read": {
        consume: async (...args: unknown[]) => {
          calls.push(args);
          return { ...spent, allowed: true, retryAfter: 0 } as never;
        },
      },
    }).take("visitor-read", "203.0.113.7");
    expect(calls).toEqual([[{ key: "203.0.113.7" }, 1, { timeoutMs: 200 }]]);
  });

  test("an allowed call is allowed", async () => {
    expect(await verdictOf({ ...spent, allowed: true, retryAfter: 0 })).toEqual(
      {
        allowed: true,
        retryAfter: 0,
      },
    );
  });

  test("a spent budget is refused with the wait in whole seconds, rounded up", async () => {
    expect(await verdictOf(spent)).toEqual({ allowed: false, retryAfter: 2 });
  });

  test("Redis down, slow or failing lets the read through (fail open)", async () => {
    for (const error of [
      new GuardError("TIMEOUT", "visitor-read", "no answer"),
      new Error("connection closed"),
    ]) {
      expect(await verdictOf(error)).toEqual({ allowed: true, retryAfter: 0 });
    }
  });
});

describe("the visitor read limit", () => {
  test("120 a minute per address, 40 at once", () => {
    expect(limits["visitor-read"]).toMatchObject({
      name: "visitor-read",
      limit: 120,
      per: 60_000,
      burst: 40,
    });
    expect(limits["visitor-read"].key({ key: "a" })).toBe("a");
  });
});
