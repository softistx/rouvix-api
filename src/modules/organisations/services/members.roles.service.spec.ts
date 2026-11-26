import { beforeEach, describe, expect, test } from "bun:test";
import { type Viewer, viewerOf } from "@/auth/access";
import { mongo } from "@/config/db";
import { scoped } from "@/tenancy";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { refusal } from "~/refusals";
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

describe("setRole and remove", () => {
  test("another organisation's member is not found, though the id is real", async () => {
    const [a, b] = [await viewerAt(1), await viewerAt(2)];
    const one = await organisationOf("une", a);
    const two = await organisationOf("deux", b);
    const [own] = await scoped(mongo.db.members, two._id).findMany({});
    const code = (promise: Promise<unknown>) =>
      refusal(promise).then((e) => e.extensions["code"]);
    expect(
      await code(members.setRole(one._id, String(own?._id), "AGENT")),
    ).toBe("organisations.errors.member-not-found");
    expect(await code(members.remove(one._id, String(own?._id)))).toBe(
      "organisations.errors.member-not-found",
    );
    expect(await scoped(mongo.db.members, two._id).count({})).toBe(1);
  });

  test("the last admin is protected, a pending admin does not count for it", async () => {
    const admin = await viewerAt(1);
    const organisation = await organisationOf("mairie", admin);
    const [own] = await scoped(mongo.db.members, organisation._id).findMany({});
    await members.invite(admin, organisation._id, {
      phone: fakeE164(2),
      role: "ADMIN",
    });
    const lastAdmin = "organisations.errors.last-admin";
    expect(
      (await refusal(members.remove(organisation._id, String(own?._id))))
        .extensions["code"],
    ).toBe(lastAdmin);
    expect(
      (
        await refusal(
          members.setRole(organisation._id, String(own?._id), "AGENT"),
        )
      ).extensions["code"],
    ).toBe(lastAdmin);
  });

  test("an invitation withdrawn is archived, out of the list, and its phone can be invited again", async () => {
    const admin = await viewerAt(1);
    const organisation = await organisationOf("mairie", admin);
    const { member } = await members.invite(admin, organisation._id, {
      phone: fakeE164(2),
      role: "AGENT",
    });
    expect(await members.remove(organisation._id, String(member.id))).toBe(
      member._id.toHexString(),
    );
    const list = await members.list(organisation._id, {
      first: 20,
      after: null,
    });
    expect(list.totalCount).toBe(1);
    const again = await members.invite(admin, organisation._id, {
      phone: fakeE164(2),
      role: "AGENT",
    });
    expect(again.member.status).toBe("INVITED");
  });

  test("a repeated setRole heals a relation that was lost", async () => {
    const [admin, guest] = [await viewerAt(1), await viewerAt(2)];
    const organisation = await organisationOf("mairie", admin);
    const { token } = await members.invite(admin, organisation._id, {
      phone: guest.phone,
      role: "AGENT",
    });
    const { member } = await members.accept(guest, token);
    await new OrganisationRelations(kit.auth).release(
      organisation._id,
      guest.id,
      "AGENT",
    );
    await members.setRole(organisation._id, member._id.toHexString(), "AGENT");
    const can = await kit.auth.permissions.can(
      { type: "user", id: guest.id },
      "work",
      { type: "organisation", id: organisation._id.toHexString() },
    );
    expect(can).toBe(true);
  });
});

describe("list", () => {
  test("pages the organisation's members, oldest first, with the total", async () => {
    const admin = await viewerAt(1);
    const organisation = await organisationOf("mairie", admin);
    for (const n of [2, 3, 4]) {
      await members.invite(admin, organisation._id, {
        phone: fakeE164(n),
        role: "AGENT",
      });
    }
    const first = await members.list(organisation._id, {
      first: 2,
      after: null,
    });
    expect(first.totalCount).toBe(4);
    expect(first.edges).toHaveLength(2);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const next = await members.list(organisation._id, {
      first: 2,
      after: first.pageInfo.endCursor,
    });
    expect(next.edges).toHaveLength(2);
    expect(next.pageInfo.hasNextPage).toBe(false);
  });
});
