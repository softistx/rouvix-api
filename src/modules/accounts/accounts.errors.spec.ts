import { describe, expect, test } from "bun:test";
import { codes, suspended, unknownCountry } from "./accounts.errors";

describe("codes", () => {
  test("are the module's, each under `accounts.errors.`", () => {
    expect(codes).toEqual([
      "accounts.errors.suspended",
      "accounts.errors.unknown-country",
    ]);
  });
});

describe("refusals", () => {
  test("a suspended account is 403", () => {
    const error = suspended();
    expect(error.extensions["code"]).toBe("accounts.errors.suspended");
    expect(error.extensions["http"]).toMatchObject({ status: 403 });
  });

  test("an unknown country is 400 on `phone`, naming the prefix only", () => {
    const error = unknownCountry("+999600000001");
    expect(error.extensions["code"]).toBe("accounts.errors.unknown-country");
    expect(error.extensions["http"]).toMatchObject({ status: 400 });
    expect(error.extensions["field"]).toBe("phone");
    expect(error.extensions["params"]).toEqual({ prefix: "+999" });
  });
});
