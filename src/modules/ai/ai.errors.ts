import { defineCodes } from "@/i18n/define-codes";
import { fail } from "@/shared/errors";

// The codes of the AI pipeline (`ai.errors.<slug>`, spec §9), gathered by the
// inventory `ErrorCode` (src/i18n/codes.ts). Their messages are translations
// in the database (src/migrations), CONTEXT.md lists them.
export const codes = defineCodes("ai", [
  "document-photo",
  "unavailable",
  "photo-not-found",
]);

// The photo is, or looks like, an ID document's: it is never sent to a remote
// service (spec §4.3). The declare form switches to a document category.
export const documentPhoto = () =>
  fail("ai.errors.document-photo", { status: 422 });

// No suggestion can be made right now: the local check could not run (the OCR
// is down), Claude is down or over the day's cap. Nothing is sent or nothing
// comes back, and the declare form works without a suggestion.
export const aiUnavailable = () =>
  fail("ai.errors.unavailable", { status: 503 });

// The photo key names no upload of the viewer's: one answer for an unknown key
// and for another account's photo.
export const photoNotFound = () =>
  fail("ai.errors.photo-not-found", { status: 404 });
