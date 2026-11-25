import { describe, expect, test } from "bun:test";
import { refusal } from "~/refusals";
import {
  alreadyMember,
  codes,
  invitationInvalid,
  lastAdmin,
  locked,
  memberNotFound,
  organisationNotFound,
  slugReserved,
  slugTaken,
  staleVersion,
} from "./organisations.errors";

const statusOf = (error: { extensions: Record<string, unknown> }) =>
  error.extensions["http"];

describe("codes", () => {
  test("are the module's, each under `organisations.errors.`", () => {
    expect(codes).toEqual([
      "organisations.errors.organisation-not-found",
      "organisations.errors.member-not-found",
      "organisations.errors.slug-taken",
      "organisations.errors.slug-reserved",
      "organisations.errors.already-member",
      "organisations.errors.invitation-invalid",
      "organisations.errors.last-admin",
      "organisations.errors.stale-version",
    ]);
  });
});

describe("refusals", () => {
  test("not found, in two flavours, are 404", () => {
    expect(statusOf(organisationNotFound())).toEqual({ status: 404 });
    expect(statusOf(memberNotFound())).toEqual({ status: 404 });
    expect(statusOf(invitationInvalid())).toEqual({ status: 404 });
  });

  test("a taken slug is 409 on `slug`, with the slug as a param", () => {
    const error = slugTaken("mairie");
    expect(error.extensions["code"]).toBe("organisations.errors.slug-taken");
    expect(statusOf(error)).toEqual({ status: 409 });
    expect(error.extensions["params"]).toEqual({ slug: "mairie" });
    expect(error.extensions["fields"]).toMatchObject([{ path: "slug" }]);
  });

  test("a reserved slug is 400 on `slug`, with the slug as a param", () => {
    const error = slugReserved("settings");
    expect(error.extensions["code"]).toBe("organisations.errors.slug-reserved");
    expect(statusOf(error)).toEqual({ status: 400 });
    expect(error.extensions["fields"]).toMatchObject([{ path: "slug" }]);
  });

  test("an already invited active member is 409 on `phone`", () => {
    const error = alreadyMember();
    expect(statusOf(error)).toEqual({ status: 409 });
    expect(error.extensions["fields"]).toMatchObject([{ path: "phone" }]);
  });

  test("the last admin and a stale write are 409", () => {
    expect(statusOf(lastAdmin())).toEqual({ status: 409 });
    expect(statusOf(staleVersion())).toEqual({ status: 409 });
  });
});

describe("locked", () => {
  test("passes a result through, and lets another error through untouched", async () => {
    expect(await locked(async () => 3)).toBe(3);
    const error = await refusal(
      locked(async () => {
        throw lastAdmin();
      }),
    );
    expect(error.extensions["code"]).toBe("organisations.errors.last-admin");
  });
});
