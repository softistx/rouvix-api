import { ConflictError, isObjectIdString } from "@softistx/mongo";
import { defineCodes } from "@/i18n/define-codes";
import { fail } from "@/shared/errors";
import { locked as lock } from "@/shared/locked";

// The codes the module answers with (`listings.errors.<slug>`): the inventory
// `ErrorCode` (src/i18n/codes.ts) gathers. Their messages are translations in
// the database (src/migrations), CONTEXT.md lists them. A refusal about one
// input field (a category, a document type, a photo) is a field of one
// `validation.errors.invalid-input`.
export const codes = defineCodes("listings", [
  "listing-not-found",
  "category-invalid",
  "document-type-invalid",
  "photo-invalid",
  "invalid-status",
  "extension-limit",
  "stale-version",
]);

// A listing that does not exist, is not public, or that the viewer may not
// edit: one answer, so nothing tells a stranger a draft exists.
export const listingNotFound = () =>
  fail("listings.errors.listing-not-found", { status: 404 });

// The id a client sent, when it has the shape of one: any other names no listing.
export const listingIdOf = (id: string) => {
  if (!isObjectIdString(id)) throw listingNotFound();
  return id;
};

// The operation does not fit the listing's status.
export const invalidStatus = (status: string) =>
  fail("listings.errors.invalid-status", { status: 409, params: { status } });

// An open listing was already extended the most it may be.
export const extensionLimit = (limit: number) =>
  fail("listings.errors.extension-limit", { status: 409, params: { limit } });

export const staleVersion = () =>
  fail("listings.errors.stale-version", { status: 409 });

// Writes on a listing lock on its version when the client names one; a write
// that keeps losing is the whole-call 409 `stale-version`.
export const locked = <T>(versionGiven: boolean, write: () => Promise<T>) =>
  lock(versionGiven, write, { stale: staleVersion, lost: [ConflictError] });
