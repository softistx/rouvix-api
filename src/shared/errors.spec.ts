import { describe, expect, test } from "bun:test";
import {
  fail,
  failOnFields,
  idsIssue,
  invalidInput,
  retryParams,
} from "./errors";

describe("fail", () => {
  test("carries its params in extensions when given", () => {
    const error = fail("organisations.errors.slug-taken", {
      params: { slug: "mairie-douala" },
      status: 409,
    });
    expect(error.extensions["code"]).toBe("organisations.errors.slug-taken");
    expect(error.extensions["params"]).toEqual({ slug: "mairie-douala" });
    expect(error.extensions["http"]).toEqual({ status: 409 });
    expect(error.message).toContain("mairie-douala");
  });

  test("has no params key without params", () => {
    const error = fail("auth.errors.forbidden", { status: 403 });
    expect("params" in error.extensions).toBe(false);
  });
});

describe("the error inventory", () => {
  test("fail, the field issues and failOnFields take a code of the inventory only", () => {
    // @ts-expect-error not an ErrorCode
    fail("organisations.errors.not-a-code");
    // @ts-expect-error not an ErrorCode
    idsIssue(0, "organisations.errors.not-a-code");
    // @ts-expect-error not an ErrorCode
    invalidInput([{ path: "x", code: "validation.errors.not-a-code" }]);
    // @ts-expect-error not an ErrorCode
    failOnFields("accounts.errors.not-a-code", []);
  });
});

describe("invalidInput", () => {
  test("adds params to the fields that have them only", () => {
    const error = invalidInput([
      {
        path: "name",
        code: "validation.errors.too-long",
        params: { limit: 5 },
      },
      { path: "other", code: "validation.errors.required" },
    ]);
    expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
    expect(error.extensions["fields"]).toEqual([
      {
        path: "name",
        code: "validation.errors.too-long",
        message: "Cette valeur est trop longue.",
        params: { limit: 5 },
      },
      {
        path: "other",
        code: "validation.errors.required",
        message: "Ce champ est obligatoire.",
      },
    ]);
  });
});

describe("retryParams", () => {
  test("keeps the seconds and rounds them up to whole minutes, at least one", () => {
    expect(retryParams(1)).toEqual({ retryAfter: 1, minutes: 1 });
    expect(retryParams(60)).toEqual({ retryAfter: 60, minutes: 1 });
    expect(retryParams(61)).toEqual({ retryAfter: 61, minutes: 2 });
    expect(retryParams(3600)).toEqual({ retryAfter: 3600, minutes: 60 });
  });
});
