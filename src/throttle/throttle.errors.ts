import { defineCodes } from "@/i18n/define-codes";
import { fail, retryParams } from "@/shared/errors";

// The codes of the throttle (`throttle.errors.<slug>`, spec §9), gathered by
// the inventory `ErrorCode` (src/i18n/codes.ts). Their messages are
// translations in the database (src/migrations).
export const codes = defineCodes("throttle", ["too-many"]);

// An address spent its budget: 429, with the wait in seconds and in minutes.
export const tooMany = (retryAfter: number) =>
  fail("throttle.errors.too-many", {
    status: 429,
    params: retryParams(retryAfter),
  });
