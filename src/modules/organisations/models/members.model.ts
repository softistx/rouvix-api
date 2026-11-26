import { defineCollection, id } from "@softistx/mongo";
import { z } from "zod";
import { accountId, actors } from "@/shared/actors";
import { tenantField } from "@/tenancy";

export const memberRole = z.enum(["AGENT", "ADMIN"]);
export type MemberRole = z.infer<typeof memberRole>;

export const memberStatus = z.enum(["INVITED", "ACTIVE"]);
export type MemberStatus = z.infer<typeof memberStatus>;

// A member of an organisation, or a person invited by phone. Organisation-owned:
// read and written through `scoped()` only. `phone` is E.164 and never leaves
// the API whole (spec §8): an administrator sees it masked. `accountId` is
// null until the invited person accepts. The invitation token is the proof of
// who may accept and only its sha256 is stored (`tokenHash`); acceptance also
// requires the signed-in account's phone to be `phone`, so a leaked token is
// of no use to anyone else. The relation janus holds (`organisation#admins` or
// `#agents`) mirrors `role` of an ACTIVE member.
export const members = defineCollection({
  name: "members",
  schema: z.object({
    _id: id(),
    ...tenantField,
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    accountId: accountId.nullable().default(null),
    role: memberRole,
    status: memberStatus,
    tokenHash: z.string().length(64).nullable().default(null),
    expiresAt: z.date().nullable().default(null),
    invitedBy: accountId,
  }),
  timestamps: true,
  softDelete: true,
  optimisticLock: true,
  actors,
  indexes: [
    {
      key: { organisationId: 1, phone: 1 },
      name: "members_organisation_phone",
    },
    {
      key: { organisationId: 1, accountId: 1 },
      name: "members_organisation_account",
    },
    {
      key: { organisationId: 1, tokenHash: 1 },
      name: "members_organisation_token",
    },
  ],
});
