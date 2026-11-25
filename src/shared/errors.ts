import {
  fieldsError,
  invalidInputError,
  type Translate,
} from "@softistx/graphql-validation";
import type { ErrorHttp } from "@softistx/graxia";
import { GraphQLError, type GraphQLErrorOptions } from "graphql";
import { i18n } from "../i18n";
import type { ErrorCode } from "../i18n/codes";
import { formatted, type Params } from "../i18n/params";

// A refused operation: `extensions.code` is the error code, stable, which
// clients map to their own translation; `message` is that key translated in
// the request's language, their fallback; `extensions.params`, when given, are
// the values that message interpolates ({name}, {retryAfter}…), so a client
// can word the refusal itself; `extensions["http"].status`, when given, is the
// HTTP status graxia answers a single operation with (graxia 0.10, graxia#147);
// `extensions.field`, when given, names the input field it is about.
export function fail(
  code: ErrorCode,
  options: { params?: Params; status?: number; field?: string } = {},
): GraphQLError {
  return new GraphQLError(i18n.t(code, formatted(options.params)), {
    extensions: {
      code,
      ...(options.params && { params: options.params }),
      ...(options.status && {
        http: { status: options.status } satisfies ErrorHttp,
      }),
      ...(options.field && { field: options.field }),
    },
  });
}

// janus's store (sessions, accounts, relations) could not answer: 503, never
// a refusal, which would read as "signed out" or "not allowed".
export const unavailable = () =>
  fail("auth.errors.unavailable", { status: 503 });

// One refused field of an input: `path` is relative to the input
// ("schoolNumber", "person.firstName"), `code` an error code, `params` the
// values its message interpolates (a limit, a name), passed on to clients.
export interface FieldIssue {
  path: string;
  code: ErrorCode;
  params?: Params;
}

// The path of the id at index `i` of a bulk operation's list (`ids`, or
// `studentIds`, `enrollmentIds`: `prefix`).
export const idsPath = (i: number, prefix = "ids") => `${prefix}.${i}`;

// The issue about the id at index `i` of a bulk operation's list.
export const idsIssue = (
  i: number,
  code: FieldIssue["code"],
  params?: FieldIssue["params"],
  prefix = "ids",
): FieldIssue => ({
  path: idsPath(i, prefix),
  code,
  ...(params && { params }),
});

// The ids of a bulk operation with their index in the input, a repeated id
// counted once (at its first place).
export function distinctIds(ids: readonly string[]): [number, string][] {
  const seen = new Set<string>();
  const kept: [number, string][] = [];
  for (const [i, id] of ids.entries()) {
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push([i, id]);
  }
  return kept;
}

// The request's language, for the builders of @softistx/graphql-validation.
const translate: Translate = (code, params) =>
  i18n.t(code as ErrorCode, formatted(params));

// An input refused as a whole, with every field that refused it: one error
// whatever the module, `validation.errors.invalid-input`, status 400, and
// `extensions.fields: [{ path, code, message, params? }]`, each message
// translated (@softistx/graphql-validation's `invalidInputError`).
export const invalidInput = (
  issues: FieldIssue[],
  options: GraphQLErrorOptions = {},
): GraphQLError => invalidInputError(issues, { ...options, translate });

export const forbidden = () => fail("auth.errors.forbidden", { status: 403 });

// A refusal (its own code, status and params) about input fields, which it
// also lists as `extensions.fields`: a conflict (409) that a form shows beside
// the fields at fault (@softistx/graphql-validation's `fieldsError`).
export const failOnFields = (
  code: ErrorCode,
  issues: FieldIssue[],
  options: { params?: Params; status?: number } = {},
): GraphQLError => fieldsError(code, issues, { ...options, translate });

// The params of a refusal that says when to try again: `retryAfter` in whole
// seconds and `minutes`, the same wait rounded up to whole minutes (at least 1),
// which the messages word ("in 5 minutes") instead of counting seconds.
export const retryParams = (retryAfter: number) => ({
  retryAfter,
  minutes: Math.max(1, Math.ceil(retryAfter / 60)),
});
