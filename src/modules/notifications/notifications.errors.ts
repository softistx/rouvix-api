import { defineCodes } from "@/i18n/define-codes";
import { fail } from "@/shared/errors";

// The codes the module answers with (`notifications.errors.<slug>`): the
// inventory `ErrorCode` (src/i18n/codes.ts) gathers. Their messages are
// translations in the database (src/migrations), CONTEXT.md lists them. A
// refusal about one input field (a push endpoint) is a field of one
// `validation.errors.invalid-input`.
export const codes = defineCodes("notifications", [
  "notification-not-found",
  "push-unavailable",
]);

// An id that names no notice of the viewer's: one answer for an unknown id and
// for another account's notice (listed per id by `markRead`, all or nothing).
export const notificationNotFound = () =>
  fail("notifications.errors.notification-not-found", { status: 404 });

// No Web Push is wired (no VAPID keys, or no adapter for production): the
// browser keeps the in-app notices and the e-mail copies.
export const pushUnavailable = () =>
  fail("notifications.errors.push-unavailable", { status: 503 });
