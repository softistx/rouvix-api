import { describe, expect, test } from "bun:test";
import { refusal } from "~/refusals";
import { throttleVisitor } from "./guard";
import type { Throttle } from "./throttle";

const recording = (allowed: boolean, retryAfter = 0) => {
  const taken: [string, string][] = [];
  const throttle: Throttle = {
    take: async (scope, key) => {
      taken.push([scope, key]);
      return { allowed, retryAfter };
    },
  };
  return { taken, throttle };
};

describe("throttleVisitor", () => {
  test("counts the address, an IPv6 one by its /64", async () => {
    const v4 = recording(true);
    await throttleVisitor({ ip: "203.0.113.7", throttle: v4.throttle });
    expect(v4.taken).toEqual([["visitor-read", "203.0.113.7"]]);
    const v6 = recording(true);
    await throttleVisitor({
      ip: "2001:db8:0:1:aaaa:bbbb:cccc:dddd",
      throttle: v6.throttle,
    });
    expect(v6.taken).toEqual([["visitor-read", "2001:db8:0:1::/64"]]);
    const none = recording(true);
    await throttleVisitor({ ip: undefined, throttle: none.throttle });
    expect(none.taken).toEqual([["visitor-read", "unknown"]]);
  });

  test("a spent budget is 429 throttle.errors.too-many with the wait in minutes", async () => {
    const error = await refusal(
      throttleVisitor({
        ip: "203.0.113.7",
        throttle: recording(false, 61).throttle,
      }),
    );
    expect(error.extensions["code"]).toBe("throttle.errors.too-many");
    expect(error.extensions["http"]).toEqual({ status: 429 });
    expect(error.extensions["params"]).toEqual({ retryAfter: 61, minutes: 2 });
  });
});
