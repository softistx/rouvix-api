import { describe, expect, test } from "bun:test";
import { serverPush } from "./push";

describe("serverPush", () => {
  test("without VAPID keys push is off", () => {
    expect(serverPush(undefined, false).available).toBe(false);
    expect(serverPush(undefined, true).available).toBe(false);
  });

  test("with keys outside production the log adapter stands in", () => {
    expect(serverPush("A".repeat(87), false).available).toBe(true);
  });

  test("with keys in production it refuses to start: there is no adapter yet", () => {
    expect(() => serverPush("A".repeat(87), true)).toThrow(
      "no Web Push adapter",
    );
  });
});
