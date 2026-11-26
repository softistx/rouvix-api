import type { ObjectId } from "mongodb";
import { organisationObject } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import { relationOf } from "./organisations.utils";

type Role = "AGENT" | "ADMIN";

// What the module asks of janus beyond its own calls: the relations that hold
// an account's role in an organisation (`organisation#admins`, `#agents`).
// Both calls are idempotent. A failure is a janus `StoreFailure`, a 503, never
// swallowed: a right is not something to lose silently.
export class OrganisationRelations {
  constructor(private readonly auth: Pick<Auth, "permissions">) {}

  // The account holds exactly `role`: the relation it comes to, then the one
  // it leaves, so a promotion never leaves it without access.
  async hold(organisationId: ObjectId, accountId: string, role: Role) {
    const object = organisationObject(organisationId);
    const subject = { type: "user", id: accountId } as const;
    const other: Role = role === "ADMIN" ? "AGENT" : "ADMIN";
    await this.auth.permissions.grant(object, relationOf(role), subject);
    await this.auth.permissions.revoke(object, relationOf(other), subject);
  }

  // The account holds no role: what a removal and a demotion do first, inside
  // the transaction, so a failure leaves nothing granted that was taken away.
  async release(organisationId: ObjectId, accountId: string, role: Role) {
    await this.auth.permissions.revoke(
      organisationObject(organisationId),
      relationOf(role),
      { type: "user", id: accountId },
    );
  }
}
