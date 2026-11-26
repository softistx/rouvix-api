import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { organisationObject } from "@/auth/access";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { signedIn } from "~/fixtures";
import { OrganisationRelations } from "./organisations.janus";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
});

const can = (
  kitOf: AuthApp,
  account: { id: string },
  permission: "work" | "manage",
  organisationId: ObjectId,
) =>
  kitOf.auth.permissions.can(
    { type: "user", id: account.id },
    permission,
    organisationObject(organisationId),
  );

describe("OrganisationRelations", () => {
  test("an agent may work, an admin may work and manage", async () => {
    const relations = new OrganisationRelations(kit.auth);
    const { account } = await signedIn(kit);
    const id = new ObjectId();
    await relations.hold(id, account.id, "AGENT");
    expect(await can(kit, account, "work", id)).toBe(true);
    expect(await can(kit, account, "manage", id)).toBe(false);
    await relations.hold(id, account.id, "ADMIN");
    expect(await can(kit, account, "manage", id)).toBe(true);
    await relations.hold(id, account.id, "AGENT");
    expect(await can(kit, account, "manage", id)).toBe(false);
    expect(await can(kit, account, "work", id)).toBe(true);
  });

  test("release takes the role away, in that organisation only", async () => {
    const relations = new OrganisationRelations(kit.auth);
    const { account } = await signedIn(kit);
    const [a, b] = [new ObjectId(), new ObjectId()];
    await relations.hold(a, account.id, "AGENT");
    await relations.hold(b, account.id, "AGENT");
    await relations.release(a, account.id, "AGENT");
    expect(await can(kit, account, "work", a)).toBe(false);
    expect(await can(kit, account, "work", b)).toBe(true);
    await relations.release(a, account.id, "AGENT");
  });
});
