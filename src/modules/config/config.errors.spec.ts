import { describe, expect, test } from "bun:test";
import { ConflictError } from "@softistx/mongo";
import { refusal } from "~/refusals";
import {
  codes,
  countryNotFound,
  geocodingUnavailable,
  locked,
  safePlaceIdOf,
  safePlaceNotFound,
  staleVersion,
} from "./config.errors";

const statusOf = (error: { extensions: Record<string, unknown> }) =>
  error.extensions["http"];

describe("codes", () => {
  test("are the module's, each under `config.errors.`", () => {
    expect(codes).toEqual([
      "config.errors.country-not-found",
      "config.errors.document-type-unknown",
      "config.errors.category-parent-invalid",
      "config.errors.safe-place-not-found",
      "config.errors.geocoding-unavailable",
      "config.errors.stale-version",
    ]);
  });
});

describe("refusals", () => {
  test("an unknown country is 400 on its path, with the code as a param", () => {
    const error = countryNotFound("ZZ");
    expect(error.extensions["code"]).toBe("config.errors.country-not-found");
    expect(statusOf(error)).toEqual({ status: 400 });
    expect(error.extensions["params"]).toEqual({ code: "ZZ" });
    expect(error.extensions["fields"]).toMatchObject([{ path: "countryCode" }]);
  });

  test("a missing safe place is 404, the geocoder's outage 503, a stale write 409", () => {
    expect(statusOf(safePlaceNotFound())).toEqual({ status: 404 });
    expect(statusOf(geocodingUnavailable())).toEqual({ status: 503 });
    expect(statusOf(staleVersion())).toEqual({ status: 409 });
  });
});

describe("safePlaceIdOf", () => {
  test("reads an ObjectId, and an id of another shape is no place", () => {
    expect(safePlaceIdOf("6740a0000000000000000001").toHexString()).toBe(
      "6740a0000000000000000001",
    );
    expect(() => safePlaceIdOf("nope")).toThrow();
  });
});

describe("locked", () => {
  test("runs the write again after a lost unique-index race", async () => {
    let attempts = 0;
    const result = await locked(false, async () => {
      attempts += 1;
      if (attempts === 1) throw new ConflictError("lost");
      return attempts;
    });
    expect(result).toBe(2);
  });

  test("lets another error through untouched", async () => {
    const error = await refusal(
      locked(false, async () => {
        throw safePlaceNotFound();
      }),
    );
    expect(error.extensions["code"]).toBe("config.errors.safe-place-not-found");
  });
});
