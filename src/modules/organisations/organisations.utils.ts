import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { DAY_MS } from "@/shared/dates";

// An invitation lives 7 days, then it is replaced by a resend.
export const INVITATION_DAYS = 7;

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

// A fresh invitation token: `<organisationId>.<32 random bytes, base64url>`,
// the organisation first so the token names its tenant. Only the sha256 is
// stored; the token goes to the administrator once, who hands it on.
export function newInvitation(organisationId: ObjectId, now: Date) {
  const token = `${organisationId.toHexString()}.${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY_MS),
  };
}

// The organisation a token names, or null for a token of another shape.
export function organisationOfToken(token: string): ObjectId | null {
  const [id, secret, ...rest] = token.split(".");
  if (id === undefined || secret === undefined || rest.length > 0) return null;
  return /^[0-9a-f]{24}$/.test(id) && secret.length >= 43
    ? new ObjectId(id)
    : null;
}

// The janus relation each role is held through.
export const relationOf = (role: "AGENT" | "ADMIN") =>
  role === "ADMIN" ? "admins" : "agents";
