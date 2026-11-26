import { defineCodes } from "@/i18n/define-codes";
import { fail } from "@/shared/errors";

// The codes of the AI pipeline (`ai.errors.<slug>`, spec §9), gathered by the
// inventory `ErrorCode` (src/i18n/codes.ts). Their messages are translations
// in the database (src/migrations), CONTEXT.md lists them.
export const codes = defineCodes("ai", ["document-photo", "unavailable"]);

// The photo is, or looks like, an ID document's: it is never sent to a remote
// service (spec §4.3). The declare form switches to a document category.
export const documentPhoto = () =>
  fail("ai.errors.document-photo", { status: 422 });

// The local check could not run (the OCR is down): nothing is sent, the form
// works without a suggestion.
export const aiUnavailable = () =>
  fail("ai.errors.unavailable", { status: 503 });
