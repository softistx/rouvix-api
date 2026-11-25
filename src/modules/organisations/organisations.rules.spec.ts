import { describe, expect, test } from "bun:test";
import { holdsAdmin, phoneOf } from "./organisations.rules";

describe("phoneOf", () => {
  test("normalises a number to E.164", () => {
    expect(phoneOf("+237 6 00 00 00 01")).toEqual({ phone: "+237600000001" });
  });

  test("refuses a number with the issue on its path", () => {
    expect(phoneOf("600000001")).toEqual({
      issue: { path: "phone", code: "validation.errors.invalid-format" },
    });
    expect(phoneOf("nope", "member.phone")).toEqual({
      issue: { path: "member.phone", code: "validation.errors.invalid-format" },
    });
  });
});

describe("holdsAdmin", () => {
  test("only an active admin counts as the administrator an organisation keeps", () => {
    expect(holdsAdmin({ role: "ADMIN", status: "ACTIVE" })).toBe(true);
    expect(holdsAdmin({ role: "ADMIN", status: "INVITED" })).toBe(false);
    expect(holdsAdmin({ role: "AGENT", status: "ACTIVE" })).toBe(false);
  });
});
