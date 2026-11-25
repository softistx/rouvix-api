import { inputPath } from "@softistx/graphql-validation";
import { definePlugin, type ExecutionOutput } from "@softistx/graxia";
import { StoreFailure } from "@softistx/janus";
import { GraphQLError } from "graphql";
import type { ErrorCode } from "../i18n/codes";
import { invalidInput, unavailable } from "../shared/errors";

// What the refusal of a `@constraint` argument becomes: @softistx/graphql-
// validation names the argument that refused in `issues[].constraint`.
const constraintCodes: Record<string, ErrorCode> = {
  minLength: "validation.errors.too-short",
  maxLength: "validation.errors.too-long",
  min: "validation.errors.out-of-range",
  max: "validation.errors.out-of-range",
  exclusiveMin: "validation.errors.out-of-range",
  exclusiveMax: "validation.errors.out-of-range",
  multipleOf: "validation.errors.out-of-range",
  minItems: "validation.errors.too-few",
  maxItems: "validation.errors.too-many",
  format: "validation.errors.invalid-format",
  pattern: "validation.errors.invalid-format",
};

interface ConstraintIssue {
  path: readonly (string | number)[];
  constraint?: string;
}

// The issues of a @constraint refusal (BAD_USER_INPUT), as the resolver
// threw it or as graphql-js wrapped it with the field's location.
function constraintIssues(error: GraphQLError): ConstraintIssue[] | undefined {
  const source =
    error.extensions["code"] === "BAD_USER_INPUT" ? error : error.originalError;
  if (!(source instanceof GraphQLError)) return undefined;
  if (source.extensions["code"] !== "BAD_USER_INPUT") return undefined;
  const issues = source.extensions["issues"];
  return Array.isArray(issues) ? (issues as ConstraintIssue[]) : undefined;
}

// A mapper of a module's own: the error as the API words it, or `undefined`
// when it is not the mapper's (passed in by src/app.ts, so that shared/ does
// not import the modules that import it).
export type ErrorMapper = (error: GraphQLError) => GraphQLError | undefined;

// The app's shape of an invalid input (`invalidInput`) for a @constraint
// refusal, at the field's location; any other error as it is.
function reshaped(
  error: GraphQLError,
  mappers: readonly ErrorMapper[],
): GraphQLError {
  for (const map of mappers) {
    const mapped = map(error);
    if (mapped) return mapped;
  }
  const issues = constraintIssues(error);
  if (!issues) return error;
  return invalidInput(
    issues.map((issue) => ({
      path: inputPath(issue.path),
      code:
        (issue.constraint && constraintCodes[issue.constraint]) ||
        "validation.errors.invalid",
      // No params: @softistx/graphql-validation does not expose a constraint's
      // limit yet (to be proposed to the package, not worked around here).
    })),
    {
      nodes: error.nodes ?? null,
      source: error.source ?? null,
      positions: error.positions ?? null,
      path: error.path ?? null,
    },
  );
}

// The error a resolver's janus outage becomes: `auth.errors.unavailable`, at
// the field's location; any other error as it is.
function outage(error: GraphQLError): GraphQLError {
  if (!(error.originalError instanceof StoreFailure)) return error;
  const { message, extensions } = unavailable();
  return new GraphQLError(message, {
    nodes: error.nodes ?? null,
    source: error.source ?? null,
    positions: error.positions ?? null,
    path: error.path ?? null,
    extensions,
  });
}

// A graxia plugin (src/app.ts; `mappers` first, e.g. the janus invitation
// fields' `fromJanusInvitation`): @constraint refusals (@softistx/graphql-
// validation's BAD_USER_INPUT) leave as every other invalid input does, and
// a janus outage as `auth.errors.unavailable` (503), not masked as a 500. It
// rewrites the execution's result, before graxia's masking.
export const apiErrorsWith = (mappers: readonly ErrorMapper[]) => {
  const reword = (errors: readonly GraphQLError[]) => {
    const changed = errors.map((error) => outage(reshaped(error, mappers)));
    return changed.every((error, i) => error === errors[i])
      ? undefined
      : changed;
  };
  // The after-hook of both stages: a plain result with errors is reworded; a
  // stream or an incremental result is left alone.
  const rewrite = ({
    result,
    setResult,
  }: {
    result: ExecutionOutput | undefined;
    setResult: (result: ExecutionOutput) => void;
  }) => {
    if (!result || Symbol.asyncIterator in result || !("errors" in result))
      return;
    if (!result.errors) return;
    const changed = reword(result.errors);
    if (changed) setResult({ ...result, errors: changed });
  };
  return definePlugin({
    name: "api-errors",
    // A subscription's refusal before its stream starts (its `subscribe`
    // threw) arrives as a result with errors and is worded as any other. An
    // error thrown by the stream itself is masked by graxia, so the stream
    // maps its own (see `streamError`).
    onSubscribe: () => rewrite,
    onExecute: () => rewrite,
  });
};

export const apiErrors = apiErrorsWith([]);

// What a subscription's stream throws mid-stream, worded as an operation's
// error would be: a janus outage is `auth.errors.unavailable` (503); a
// `fail(...)` error keeps its code and params; any other error is left to
// graxia, which masks it as an internal error. A plugin cannot do this (graxia
// masks a stream's errors after the plugins), so the stream does.
export const streamError = (error: unknown): unknown =>
  error instanceof StoreFailure ? unavailable() : error;
