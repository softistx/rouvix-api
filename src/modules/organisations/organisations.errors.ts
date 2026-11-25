import { defineCodes } from "@/i18n/define-codes";
import { fail, failOnFields } from "@/shared/errors";
import { locked as lock } from "@/shared/locked";

// The codes the module answers with (`organisations.errors.<slug>`): the
// inventory `ErrorCode` (src/i18n/codes.ts) gathers. Their messages are
// translations in the database (src/migrations), CONTEXT.md lists them.
export const codes = defineCodes("organisations", [
  "organisation-not-found",
  "member-not-found",
  "slug-taken",
  "already-member",
  "invitation-invalid",
  "last-admin",
  "stale-version",
]);

// A slug that names no organisation, and one the viewer is no member of: the
// same answer, so nothing tells an outsider an organisation exists.
export const organisationNotFound = () =>
  fail("organisations.errors.organisation-not-found", { status: 404 });

// A member id of no live member of the organisation: another organisation's
// member is found by nobody (`scoped`), so it is this too.
export const memberNotFound = () =>
  fail("organisations.errors.member-not-found", { status: 404 });

export const slugTaken = (slug: string) =>
  failOnFields(
    "organisations.errors.slug-taken",
    [
      {
        path: "slug",
        code: "organisations.errors.slug-taken",
        params: { slug },
      },
    ],
    { status: 409, params: { slug } },
  );

// The phone is already invited or a member of the organisation.
export const alreadyMember = () =>
  failOnFields(
    "organisations.errors.already-member",
    [{ path: "phone", code: "organisations.errors.already-member" }],
    { status: 409 },
  );

// An unknown, expired or somebody else's token: one answer for the three.
export const invitationInvalid = () =>
  fail("organisations.errors.invitation-invalid", { status: 404 });

// The organisation would be left with no administrator.
export const lastAdmin = () =>
  fail("organisations.errors.last-admin", { status: 409 });

export const staleVersion = () =>
  fail("organisations.errors.stale-version", { status: 409 });

// Writes on an organisation's members serialise on its document; a write that
// keeps losing is the whole-call 409 `stale-version`.
export const locked = <T>(write: () => Promise<T>) =>
  lock(false, write, { stale: staleVersion });
