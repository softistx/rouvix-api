import type { ReadDocumentOf } from "@softistx/mongo";
import type { ObjectId } from "mongodb";
import type { Viewer } from "@/auth/access";
import type { AppMongo } from "@/config/db";
import type { Now } from "@/shared/dates";
import { invalidInput } from "@/shared/errors";
import { toConnection } from "@/shared/pagination";
import { scoped } from "@/tenancy";
import type { MemberRole, members } from "../models";
import {
  alreadyMember,
  invitationInvalid,
  lastAdmin,
  locked,
  memberNotFound,
} from "../organisations.errors";
import type { OrganisationRelations } from "../organisations.janus";
import { holdsAdmin, phoneOf } from "../organisations.rules";
import {
  hashToken,
  newInvitation,
  organisationOfToken,
} from "../organisations.utils";

export type MemberDocument = ReadDocumentOf<typeof members>;

// The members of an organisation and the people invited to it, by phone. Every
// read and write goes through `scoped()`, so another organisation's member is
// found by nobody. Writes serialise on the organisation's document (touched
// first, in the transaction), so two at once cannot both leave it without an
// administrator. The janus relations follow the documents: taken away inside
// the transaction (a failure undoes the write), granted after the commit (a
// repeated call grants again).
export class MembersService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly relations: OrganisationRelations,
    private readonly now: Now,
  ) {}

  private of(mongo: AppMongo, organisationId: ObjectId) {
    return scoped(mongo.db.members, organisationId);
  }

  private touch(tx: AppMongo, organisationId: ObjectId) {
    return tx.db.organisations.update(organisationId, {
      updatedAt: this.now(),
    });
  }

  async list(
    organisationId: ObjectId,
    page: { first: number; after: string | null | undefined },
  ) {
    const members = this.of(this.mongo, organisationId);
    const [items, total] = await Promise.all([
      members.paginateByCursor({
        limit: page.first,
        after: page.after ?? null,
        orderBy: "createdAt",
        direction: "asc",
      }),
      members.count({}),
    ]);
    return toConnection(page.after, items, total);
  }

  // Invites `phone` with `role`, or sends a new invitation to a phone already
  // invited (the former token stops working). The token is returned once; no
  // SMS leaves here, the sign-in slice carries the notice.
  async invite(
    viewer: Viewer,
    organisationId: ObjectId,
    input: { phone: string; role: MemberRole },
  ) {
    const parsed = phoneOf(input.phone);
    if ("issue" in parsed) throw invalidInput([parsed.issue]);
    return locked(() =>
      this.mongo.transaction(async (tx) => {
        await this.touch(tx, organisationId);
        const members = this.of(tx, organisationId);
        const held = await members.findFirst({ phone: parsed.phone });
        if (held?.status === "ACTIVE") throw alreadyMember();
        const invitation = newInvitation(organisationId, this.now());
        const fields = {
          role: input.role,
          tokenHash: invitation.tokenHash,
          expiresAt: invitation.expiresAt,
        };
        const member = held
          ? await members.update(held._id, fields)
          : await members.create({
              phone: parsed.phone,
              status: "INVITED",
              invitedBy: viewer.id,
              ...fields,
            });
        return { member, token: invitation.token };
      }),
    );
  }

  // The viewer takes the invitation `token` names: it must be live, and its
  // phone the viewer's own. Repeating it is harmless.
  async accept(viewer: Viewer, token: string) {
    const organisationId = organisationOfToken(token);
    if (organisationId === null) throw invitationInvalid();
    const organisation =
      await this.mongo.db.organisations.findById(organisationId);
    if (!organisation) throw invitationInvalid();
    const member = await locked(() =>
      this.mongo.transaction(async (tx) => {
        const members = this.of(tx, organisationId);
        const invited = await members.findFirst({
          tokenHash: hashToken(token),
        });
        if (
          !invited ||
          invited.phone !== viewer.phone ||
          (invited.accountId !== null && invited.accountId !== viewer.id) ||
          (invited.status === "INVITED" &&
            (invited.expiresAt === null || invited.expiresAt < this.now()))
        ) {
          throw invitationInvalid();
        }
        if (invited.status === "ACTIVE") return invited;
        await this.touch(tx, organisationId);
        return members.update(invited._id, {
          accountId: viewer.id,
          status: "ACTIVE",
        });
      }),
    );
    await this.relations.hold(organisationId, viewer.id, member.role);
    return { organisation, member };
  }

  // Gives `memberId` a role. An administrator cannot be demoted when they are
  // the last one. The relation is re-granted on every call, so a repeated one
  // repairs a grant that failed.
  async setRole(organisationId: ObjectId, memberId: string, role: MemberRole) {
    const member = await locked(() =>
      this.mongo.transaction(async (tx) => {
        await this.touch(tx, organisationId);
        const members = this.of(tx, organisationId);
        const found = await members.findById(memberId);
        if (!found) throw memberNotFound();
        if (found.role === "ADMIN" && role === "AGENT") {
          await this.assertAnotherAdmin(tx, organisationId, found);
          if (found.accountId !== null && found.status === "ACTIVE") {
            await this.relations.release(
              organisationId,
              found.accountId,
              "ADMIN",
            );
          }
        }
        return found.role === role
          ? found
          : members.update(found._id, { role });
      }),
    );
    if (member.accountId !== null && member.status === "ACTIVE") {
      await this.relations.hold(organisationId, member.accountId, member.role);
    }
    return member;
  }

  // Removes `memberId` (an archive: the document stays, out of every read),
  // or withdraws an invitation. The last administrator cannot be removed.
  remove(organisationId: ObjectId, memberId: string) {
    return locked(() =>
      this.mongo.transaction(async (tx) => {
        await this.touch(tx, organisationId);
        const members = this.of(tx, organisationId);
        const found = await members.findById(memberId);
        if (!found) throw memberNotFound();
        await this.assertAnotherAdmin(tx, organisationId, found);
        if (found.accountId !== null) {
          await this.relations.release(
            organisationId,
            found.accountId,
            found.role,
          );
        }
        await members.delete(found._id);
        return found._id.toHexString();
      }),
    );
  }

  // Refuses when `member` is the organisation's only active administrator.
  private async assertAnotherAdmin(
    tx: AppMongo,
    organisationId: ObjectId,
    member: MemberDocument,
  ) {
    if (!holdsAdmin(member)) return;
    const others = await this.of(tx, organisationId).count({
      role: "ADMIN",
      status: "ACTIVE",
      _id: { $ne: member._id },
    });
    if (others === 0) throw lastAdmin();
  }
}
