import { describe, expect, test } from "bun:test";
import { StoreFailure } from "@softistx/janus";
import { GraphQLError } from "graphql";
import { fail } from "../shared/errors";
import { apiErrors, streamError } from "./api-errors";

describe("constraint refusals", () => {
  const refused = (constraint: string, message: string) =>
    new GraphQLError("Invalid arguments", {
      extensions: {
        code: "BAD_USER_INPUT",
        issues: [{ path: ["input", "name"], message, code: "x", constraint }],
      },
    });

  async function reshape(error: GraphQLError) {
    const after = apiErrors.onExecute?.({} as never) as unknown as (
      a: unknown,
    ) => void;
    let result: { errors?: readonly GraphQLError[] } = { errors: [error] };
    await after({
      result,
      setResult: (next: typeof result) => {
        result = next;
      },
    });
    return result.errors?.[0];
  }

  test("a length refusal carries no params yet", async () => {
    const error = await reshape(
      refused("maxLength", "Too big: expected string to have <=100 characters"),
    );
    expect(error?.extensions["fields"]).toEqual([
      {
        path: "name",
        code: "validation.errors.too-long",
        message: "Cette valeur est trop longue.",
      },
    ]);
  });

  test("a format refusal has no params", async () => {
    const error = await reshape(refused("format", "Invalid email"));
    expect(error?.extensions["fields"]).toEqual([
      {
        path: "name",
        code: "validation.errors.invalid-format",
        message: "Ce format n'est pas valide.",
      },
    ]);
  });
});

describe("subscription errors", () => {
  const outage = () =>
    new GraphQLError("Unexpected error.", {
      originalError: new StoreFailure("sessions.x: down", {
        slot: "sessions",
        operation: "x",
      } as never),
    });
  const subscribed = (result: unknown) => {
    const after = apiErrors.onSubscribe?.({} as never) as unknown as (
      a: unknown,
    ) => void;
    let out = result as { errors?: readonly GraphQLError[] };
    after({
      result,
      setResult: (next: typeof out) => {
        out = next;
      },
    });
    return out;
  };

  test("a store outage before the stream is auth.errors.unavailable", () => {
    const out = subscribed({ errors: [outage()] });
    expect(out.errors?.[0]?.extensions["code"]).toBe("auth.errors.unavailable");
    expect(out.errors?.[0]?.extensions["http"]).toEqual({ status: 503 });
  });

  test("another refusal is left as it is, and a stream is not touched", () => {
    const refusal = fail("auth.errors.forbidden", { status: 403 });
    expect(subscribed({ errors: [refusal] }).errors?.[0]).toBe(refusal);
    const stream = { [Symbol.asyncIterator]: () => ({}) };
    expect(subscribed(stream)).toBe(stream as never);
  });

  test("a stream error: an outage is unavailable, a refusal keeps its code", () => {
    const store = new StoreFailure("x", { slot: "sessions" } as never);
    expect((streamError(store) as GraphQLError).extensions["code"]).toBe(
      "auth.errors.unavailable",
    );
    const refusal = fail("auth.errors.unauthenticated", { status: 401 });
    expect(streamError(refusal)).toBe(refusal);
  });
});
