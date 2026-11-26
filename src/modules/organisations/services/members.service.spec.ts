import { beforeEach, describe, expect, test } from "bun:test";
import { type Viewer, viewerOf } from "@/auth/access";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { issuesOf, refusal } from "~/refusals";
import { OrganisationRelations } from "../organisations.janus";
import { MembersService } from "./members.service";
import { OrganisationsService } from "./organisations.service";

let kit: AuthApp;
let organisations: OrganisationsService;
let members: MembersService;

beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
  const relations = new OrganisationRelations(kit.auth);
  organisations = new OrganisationsService(mongo, kit.auth, relations);
  members = new MembersService(
    mongo,
    relations,
    () => new Date(kit.clock.now()),
  );
});

const viewerAt = async (n: number): Promise<Viewer> =>
  viewerOf((await signedIn(kit, { phone: fakeE164(n) })).account);

async function organisationOf(slug: string, admin: Viewer) {
  return organisations.create(admin, {
    name: `Mairie ${slug}`,
    kind: "TOWN_HALL",
    slug,
    city: "Douala",
  });
}

describe("invite", () => {
  test("keeps the phone as E.164 and only the hash of the token", async () => {
    const admin = await viewerAt(1);
    const organisation = await organisationOf("mairie", admin);
    const { member, token } = await members.invite(admin, organisation._id, {
      phone: "+237 6 00 00 00 02",
      role: "AGENT",
    });
    expect(member).toMatchObject({
      phone: fakeE164(2),
      status: "INVITED",
      accountId: null,
      role: "AGENT",
    });
    expect(JSON.stringify(member)).not.toContain(token);
    expect(member.tokenHash).toHaveLength(64);
  });

  test("a phone that is no number is refused on `phone`", async () => {
    const admin = await viewerAt(1);
    const organisation = await organisationOf("mairie", admin);
    const issues = await issuesOf(
      members.invite(admin, organisation._id, {
        phone: "12 34",
        role: "AGENT",
      }),
    );
    expect(issues).toMatchObject([
      { path: "phone", code: "validation.errors.invalid-format" },
    ]);
  });

  test("a second invitation to the same phone replaces the first token", async () => {
    const admin = await viewerAt(1);
    const guest = await viewerAt(2);
    const organisation = await organisationOf("mairie", admin);
    const first = await members.invite(admin, organisation._id, {
      phone: fakeE164(2),
      role: "AGENT",
    });
    const second = await members.invite(admin, organisation._id, {
      phone: fakeE164(2),
      role: "ADMIN",
    });
    expect(second.member.id).toBe(first.member.id);
    expect(second.member.role).toBe("ADMIN");
    const stale = await refusal(members.accept(guest, first.token));
    expect(stale.extensions["code"]).toBe(
      "organisations.errors.invitation-invalid",
    );
    expect((await members.accept(guest, second.token)).member.role).toBe(
      "ADMIN",
    );
  });

  test("an active member's phone is refused as already a member", async () => {
    const admin = await viewerAt(1);
    const organisation = await organisationOf("mairie", admin);
    const issues = await issuesOf(
      members.invite(admin, organisation._id, {
        phone: fakeE164(1),
        role: "AGENT",
      }),
    );
    expect(issues).toMatchObject([
      { path: "phone", code: "organisations.errors.already-member" },
    ]);
  });
});

describe("accept", () => {
  async function invited(admin: Viewer, guest: Viewer, slug = "mairie") {
    const organisation = await organisationOf(slug, admin);
    const { token, member } = await members.invite(admin, organisation._id, {
      phone: guest.phone,
      role: "AGENT",
    });
    return { organisation, token, member };
  }

  test("activates the member for the invited account and repeating it is harmless", async () => {
    const [admin, guest] = [await viewerAt(1), await viewerAt(2)];
    const { organisation, token } = await invited(admin, guest);
    const first = await members.accept(guest, token);
    expect(first.member).toMatchObject({
      status: "ACTIVE",
      accountId: guest.id,
    });
    expect(first.organisation._id.equals(organisation._id)).toBe(true);
    const again = await members.accept(guest, token);
    expect(again.member._id.equals(first.member._id)).toBe(true);
  });

  test("another account, an expired or a forged token are refused alike", async () => {
    const [admin, guest, stranger] = [
      await viewerAt(1),
      await viewerAt(2),
      await viewerAt(3),
    ];
    const { token } = await invited(admin, guest);
    const code = (promise: Promise<unknown>) =>
      refusal(promise).then((e) => e.extensions["code"]);
    expect(await code(members.accept(stranger, token))).toBe(
      "organisations.errors.invitation-invalid",
    );
    expect(await code(members.accept(guest, `${token}x`))).toBe(
      "organisations.errors.invitation-invalid",
    );
    expect(await code(members.accept(guest, "nope"))).toBe(
      "organisations.errors.invitation-invalid",
    );
    kit.clock.advance(8 * 24 * 3600 * 1000);
    const late = new MembersService(
      mongo,
      new OrganisationRelations(kit.auth),
      () => new Date(kit.clock.now()),
    );
    expect(await code(late.accept(guest, token))).toBe(
      "organisations.errors.invitation-invalid",
    );
  });

  test("an accepted token cannot be taken by another account", async () => {
    const [admin, guest, stranger] = [
      await viewerAt(1),
      await viewerAt(2),
      await viewerAt(3),
    ];
    const { token } = await invited(admin, guest);
    await members.accept(guest, token);
    const error = await refusal(members.accept(stranger, token));
    expect(error.extensions["code"]).toBe(
      "organisations.errors.invitation-invalid",
    );
  });
});
