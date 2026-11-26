import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  hashToken,
  INVITATION_DAYS,
  newInvitation,
  organisationOfToken,
  relationOf,
} from "./organisations.utils";

describe("newInvitation", () => {
  test("is `<organisationId>.<secret>`, stores only the hash, lives seven days", () => {
    const id = new ObjectId();
    const now = new Date("2026-11-25T10:00:00Z");
    const invitation = newInvitation(id, now);
    expect(invitation.token.startsWith(`${id.toHexString()}.`)).toBe(true);
    expect(invitation.token.length).toBeGreaterThanOrEqual(24 + 1 + 43);
    expect(invitation.tokenHash).toBe(hashToken(invitation.token));
    expect(invitation.tokenHash).not.toContain(invitation.token);
    expect(invitation.expiresAt.getTime() - now.getTime()).toBe(
      INVITATION_DAYS * 24 * 3600 * 1000,
    );
  });

  test("two invitations never share a token", () => {
    const id = new ObjectId();
    const now = new Date();
    expect(newInvitation(id, now).token).not.toBe(newInvitation(id, now).token);
  });
});

describe("organisationOfToken", () => {
  test("reads the organisation a token names", () => {
    const id = new ObjectId();
    expect(
      organisationOfToken(newInvitation(id, new Date()).token)?.toHexString(),
    ).toBe(id.toHexString());
  });

  test("refuses a token of another shape", () => {
    expect(organisationOfToken("nope")).toBeNull();
    expect(
      organisationOfToken(`${new ObjectId().toHexString()}.short`),
    ).toBeNull();
    expect(organisationOfToken(`xyz.${"a".repeat(43)}`)).toBeNull();
    expect(
      organisationOfToken(
        `${new ObjectId().toHexString()}.${"a".repeat(43)}.x`,
      ),
    ).toBeNull();
  });
});

describe("relationOf", () => {
  test("an admin is held through `admins`, an agent through `agents`", () => {
    expect(relationOf("ADMIN")).toBe("admins");
    expect(relationOf("AGENT")).toBe("agents");
  });
});
