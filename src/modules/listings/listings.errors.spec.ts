import { describe, expect, test } from "bun:test";
import { refusal } from "~/refusals";
import {
  codes,
  extensionLimit,
  invalidStatus,
  listingIdOf,
  listingNotFound,
  locked,
  staleVersion,
} from "./listings.errors";

const statusOf = (error: { extensions: Record<string, unknown> }) =>
  error.extensions["http"];

describe("codes", () => {
  test("are the module's, each under `listings.errors.`", () => {
    expect(codes).toEqual([
      "listings.errors.listing-not-found",
      "listings.errors.category-invalid",
      "listings.errors.document-type-invalid",
      "listings.errors.photo-invalid",
      "listings.errors.invalid-status",
      "listings.errors.extension-limit",
      "listings.errors.stale-version",
    ]);
  });
});

describe("refusals", () => {
  test("a listing nobody may see is 404, a status that does not fit 409 with the status", () => {
    expect(statusOf(listingNotFound())).toEqual({ status: 404 });
    const status = invalidStatus("CLOSED");
    expect(statusOf(status)).toEqual({ status: 409 });
    expect(status.extensions["params"]).toEqual({ status: "CLOSED" });
  });

  test("the extension limit names the limit, a stale write is 409", () => {
    const limit = extensionLimit(3);
    expect(statusOf(limit)).toEqual({ status: 409 });
    expect(limit.extensions["params"]).toEqual({ limit: 3 });
    expect(statusOf(staleVersion())).toEqual({ status: 409 });
  });

  test("a message words the status, never prints its code", () => {
    expect(invalidStatus("CLOSED").message).not.toContain("CLOSED");
  });
});

describe("listingIdOf", () => {
  test("an id of the right shape passes, any other names no listing", () => {
    expect(listingIdOf("6740a0000000000000000001")).toBe(
      "6740a0000000000000000001",
    );
    expect(() => listingIdOf("nope")).toThrow();
  });
});

describe("locked", () => {
  test("lets another error through untouched", async () => {
    const error = await refusal(
      locked(true, async () => {
        throw listingNotFound();
      }),
    );
    expect(error.extensions["code"]).toBe("listings.errors.listing-not-found");
  });
});
