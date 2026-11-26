import { codes as accounts } from "@/modules/accounts/accounts.errors";
import { codes as organisations } from "@/modules/organisations/organisations.errors";
import { defineCodes } from "./define-codes";

// Who is asking: shared by every module, so declared here.
export const auth = defineCodes("auth", [
  "unauthenticated",
  "forbidden",
  "unavailable",
  "client-header-required",
]);

// Malformed input: shared by every module, so declared here.
export const validation = defineCodes("validation", [
  "invalid-input",
  "required",
  "invalid",
  "invalid-format",
  "too-short",
  "too-long",
  "out-of-range",
  "too-few",
  "too-many",
]);

// Every code the API answers with, in module order: the inventory. tsc refuses
// a code that is not in it (`fail`, `FieldIssue`, `failOnFields`, `idsIssue`),
// and the coverage spec requires a message for each in every shipped language.
export const errorCodes = [
  ...auth,
  ...validation,
  ...accounts,
  ...organisations,
] as const;

export type ErrorCode = (typeof errorCodes)[number];
