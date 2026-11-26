import { ConflictError } from "@softistx/mongo";
import { defineCodes } from "@/i18n/define-codes";
import { fail, failOnFields } from "@/shared/errors";
import { locked as lock } from "@/shared/locked";

// The codes the module answers with (`config.errors.<slug>`): the inventory
// `ErrorCode` (src/i18n/codes.ts) gathers. Their messages are translations in
// the database (src/migrations), CONTEXT.md lists them.
export const codes = defineCodes("config", [
  "country-not-found",
  "document-type-unknown",
  "category-parent-invalid",
  "safe-place-not-found",
  "geocoding-unavailable",
  "stale-version",
]);

// A country code no active country holds, on the input field `path`.
export const countryNotFound = (code: string, path = "countryCode") =>
  failOnFields(
    "config.errors.country-not-found",
    [{ path, code: "config.errors.country-not-found", params: { code } }],
    { status: 400, params: { code } },
  );

export const safePlaceNotFound = () =>
  fail("config.errors.safe-place-not-found", { status: 404 });

// The geocoding provider did not answer or refused: the form works without it.
export const geocodingUnavailable = () =>
  fail("config.errors.geocoding-unavailable", { status: 503 });

export const staleVersion = () =>
  fail("config.errors.stale-version", { status: 409 });

// Writes on this module's documents lock on their version, or retry: an
// upsert that lost a race to create the same key (`ConflictError`) runs again
// and finds the winner's document, then updates it.
export const locked = <T>(versionGiven: boolean, write: () => Promise<T>) =>
  lock(versionGiven, write, { stale: staleVersion, lost: [ConflictError] });
