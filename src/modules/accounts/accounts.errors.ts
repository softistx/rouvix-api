import { defineCodes } from "@/i18n/define-codes";
import { fail } from "@/shared/errors";

// The codes the module answers with (`accounts.errors.<slug>`): the inventory
// `ErrorCode` (src/i18n/codes.ts) gathers. Their messages are translations in
// the database (src/migrations), CONTEXT.md lists them.
export const codes = defineCodes("accounts", ["suspended", "unknown-country"]);

// The account is suspended: it passes no guard (src/auth/guards.ts).
export const suspended = () =>
  fail("accounts.errors.suspended", { status: 403 });

// A number whose country the dial-code table does not know, for a script that
// was not told it with `--country`.
export const unknownCountry = (phone?: string) =>
  fail("accounts.errors.unknown-country", {
    status: 400,
    field: "phone",
    ...(phone === undefined ? {} : { params: { prefix: phone.slice(0, 4) } }),
  });
