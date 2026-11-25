import { describe, expect, test } from "bun:test";
import { countryOf, rolesOf } from "./accounts.utils";

describe("countryOf", () => {
  test("reads Cameroon from +237 and nothing from an unserved dial code", () => {
    expect(countryOf("+237600000001")).toBe("CM");
    expect(countryOf("+33612345678")).toBeNull();
  });
});

describe("rolesOf", () => {
  test("every account is a USER, a platform admin and a moderator are more", () => {
    expect(rolesOf({ moderator: false, platformAdmin: false })).toEqual([
      "USER",
    ]);
    expect(rolesOf({ moderator: true, platformAdmin: false })).toEqual([
      "USER",
      "MODERATOR",
    ]);
    expect(rolesOf({ moderator: true, platformAdmin: true })).toEqual([
      "USER",
      "MODERATOR",
      "PLATFORM_ADMIN",
    ]);
  });
});
