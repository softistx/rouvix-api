import { describe, expect, test } from "bun:test";
import { formatted } from "./params";

describe("formatted", () => {
  test("leaves no params alone", () => {
    expect(formatted(undefined)).toBeUndefined();
  });

  test("gives a date param as the Date of that local day, and leaves the others", () => {
    const out = formatted({ day: "2026-09-15", slug: "mairie", count: 2 });
    expect(out?.["slug"]).toBe("mairie");
    expect(out?.["count"]).toBe(2);
    const day = out?.["day"] as Date;
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([
      2026, 8, 15,
    ]);
  });

  test("a date param that is no day stays as it is", () => {
    expect(formatted({ day: "soon" })).toEqual({ day: "soon" });
  });
});
