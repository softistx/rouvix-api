import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  test("takes the phone in any spelling, as E.164, with a default name", () => {
    expect(parseArgs(["+237 6 00 00 00 01"])).toEqual({
      args: { phone: "+237600000001", name: "Admin", countryCode: undefined },
    });
  });

  test("takes --name and --country, in any order", () => {
    expect(
      parseArgs(["--country", "fr", "+33 6 12 34 56 78", "--name", " Owner "]),
    ).toEqual({
      args: { phone: "+33612345678", name: "Owner", countryCode: "FR" },
    });
  });

  test("refuses what is missing or wrong", () => {
    expect(parseArgs([])).toEqual({ error: "the phone number is missing" });
    expect(parseArgs(["0600000001"])).toHaveProperty("error");
    expect(parseArgs(["+237600000001", "+237600000002"])).toEqual({
      error: "one phone number only",
    });
    expect(parseArgs(["+237600000001", "--nope"])).toEqual({
      error: "unknown option --nope",
    });
    expect(parseArgs(["+237600000001", "--name"])).toEqual({
      error: "--name needs a value",
    });
    expect(parseArgs(["+237600000001", "--country", "FRA"])).toHaveProperty(
      "error",
    );
    expect(parseArgs(["+237600000001", "--name", " "])).toHaveProperty("error");
  });
});
