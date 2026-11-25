import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase } from "~/db";
import { fakeE164, fakePhone, signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";

// Through the REAL janus: the sessions are opened by janus's own
// `signInProven` (test/fixtures.ts), the guards read its relations.

const CREATE_ORGANISATION_MUTATION = graphql(`
  mutation CreateOrganisation($input: CreateOrganisationInput!) {
    createOrganisation(input: $input) {
      id
      slug
      name
      kind
      verifiedAt
    }
  }
`);

const INVITE_MEMBER_MUTATION = graphql(`
  mutation InviteMember($slug: String!, $phone: String!, $role: OrganisationRole!) {
    inviteMember(slug: $slug, phone: $phone, role: $role) {
      token
      member {
        id
        role
        status
        phoneMasked
      }
    }
  }
`);

const ACCEPT_MEMBERSHIP_MUTATION = graphql(`
  mutation AcceptMembership($token: String!) {
    acceptMembership(token: $token) {
      role
      organisation {
        slug
      }
    }
  }
`);

const SET_MEMBER_ROLE_MUTATION = graphql(`
  mutation SetMemberRole($slug: String!, $memberId: ID!, $role: OrganisationRole!) {
    setMemberRole(slug: $slug, memberId: $memberId, role: $role) {
      id
      role
    }
  }
`);

const REMOVE_MEMBER_MUTATION = graphql(`
  mutation RemoveMember($slug: String!, $memberId: ID!) {
    removeMember(slug: $slug, memberId: $memberId)
  }
`);

const ORGANISATION_QUERY = graphql(`
  query OrganisationBySlug($slug: String!) {
    organisation(slug: $slug) {
      id
      slug
    }
  }
`);

const ORGANISATION_MEMBERS_QUERY = graphql(`
  query OrganisationMembers($slug: String!, $first: Int) {
    organisationMembers(slug: $slug, first: $first) {
      totalCount
      edges {
        node {
          id
          role
          status
          phoneMasked
        }
      }
    }
  }
`);

const VIEWER_ORGANISATIONS_QUERY = graphql(`
  query ViewerOrganisations {
    viewer {
      roles
      organisations {
        role
        organisation {
          slug
        }
      }
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
});

const input = (slug: string) => ({
  name: `Mairie ${slug}`,
  kind: "TOWN_HALL" as const,
  slug,
  city: "Douala",
});

// An organisation `slug` made by its first admin, the admin signed in.
async function organisationOf(slug: string, phone: string) {
  const admin = await signedIn(kit, { phone, name: `Admin ${slug}` });
  const made = await kit
    .client(admin.token)
    .query(CREATE_ORGANISATION_MUTATION, { variables: { input: input(slug) } });
  expect(made.errors).toBeUndefined();
  return admin;
}

// A person invited to `slug` by `admin` and who accepted.
async function invitedAs(
  admin: { token: string },
  slug: string,
  phone: string,
  role: "AGENT" | "ADMIN",
) {
  const person = await signedIn(kit, { phone });
  const invited = await kit.client(admin.token).query(INVITE_MEMBER_MUTATION, {
    variables: { slug, phone: fakePhone(Number(phone.slice(-2))), role },
  });
  const token = invited.data?.inviteMember.token as string;
  const accepted = await kit
    .client(person.token)
    .query(ACCEPT_MEMBERSHIP_MUTATION, { variables: { token } });
  expect(accepted.errors).toBeUndefined();
  return {
    ...person,
    memberId: invited.data?.inviteMember.member.id as string,
  };
}

describe("the slice's flow", () => {
  test("create an organisation, invite an agent by phone, who is refused an admin mutation", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    const agent = await invitedAs(admin, "mairie-douala", fakeE164(2), "AGENT");

    const refused = await kit
      .client(agent.token)
      .query(INVITE_MEMBER_MUTATION, {
        variables: {
          slug: "mairie-douala",
          phone: fakePhone(3),
          role: "AGENT",
        },
      });
    expect(codeOf(refused)).toBe("auth.errors.forbidden");
    expect(refused.status).toBe(403);

    const read = await kit
      .client(agent.token)
      .query(ORGANISATION_QUERY, { variables: { slug: "mairie-douala" } });
    expect(read.data?.organisation.slug).toBe("mairie-douala");
  });

  test("the viewer lists their organisations with their role in each", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    const agent = await invitedAs(admin, "mairie-douala", fakeE164(2), "AGENT");
    const asAdmin = await kit
      .client(admin.token)
      .query(VIEWER_ORGANISATIONS_QUERY);
    expect(asAdmin.data?.viewer?.roles).toEqual(["USER"]);
    expect(asAdmin.data?.viewer?.organisations).toEqual([
      { role: "ADMIN", organisation: { slug: "mairie-douala" } },
    ]);
    const asAgent = await kit
      .client(agent.token)
      .query(VIEWER_ORGANISATIONS_QUERY);
    expect(asAgent.data?.viewer?.organisations[0]?.role).toBe("AGENT");
  });

  test("an invitation is for the invited phone only", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    const invited = await kit
      .client(admin.token)
      .query(INVITE_MEMBER_MUTATION, {
        variables: {
          slug: "mairie-douala",
          phone: fakePhone(2),
          role: "AGENT",
        },
      });
    const token = invited.data?.inviteMember.token as string;
    const stranger = await signedIn(kit, { phone: fakeE164(9) });
    const refused = await kit
      .client(stranger.token)
      .query(ACCEPT_MEMBERSHIP_MUTATION, { variables: { token } });
    expect(codeOf(refused)).toBe("organisations.errors.invitation-invalid");
    const anonymous = await kit
      .client()
      .query(ACCEPT_MEMBERSHIP_MUTATION, { variables: { token } });
    expect(codeOf(anonymous)).toBe("auth.errors.unauthenticated");
  });
});

describe("another organisation gets not-found", () => {
  test("a member of another organisation reads, lists and writes nothing in it", async () => {
    const douala = await organisationOf("mairie-douala", fakeE164(1));
    const yaounde = await organisationOf("mairie-yaounde", fakeE164(5));
    const invited = await kit
      .client(douala.token)
      .query(INVITE_MEMBER_MUTATION, {
        variables: {
          slug: "mairie-douala",
          phone: fakePhone(2),
          role: "AGENT",
        },
      });
    const memberId = invited.data?.inviteMember.member.id as string;
    const as = kit.client(yaounde.token);
    const notFound = "organisations.errors.organisation-not-found";

    const read = await as.query(ORGANISATION_QUERY, {
      variables: { slug: "mairie-douala" },
    });
    expect(codeOf(read)).toBe(notFound);
    expect(read.status).toBe(404);
    const unknown = await as.query(ORGANISATION_QUERY, {
      variables: { slug: "nowhere" },
    });
    expect(codeOf(unknown)).toBe(notFound);
    const list = await as.query(ORGANISATION_MEMBERS_QUERY, {
      variables: { slug: "mairie-douala" },
    });
    expect(codeOf(list)).toBe(notFound);
    const invite = await as.query(INVITE_MEMBER_MUTATION, {
      variables: { slug: "mairie-douala", phone: fakePhone(3), role: "AGENT" },
    });
    expect(codeOf(invite)).toBe(notFound);
    const role = await as.query(SET_MEMBER_ROLE_MUTATION, {
      variables: { slug: "mairie-douala", memberId, role: "ADMIN" },
    });
    expect(codeOf(role)).toBe(notFound);
  });

  test("a member id of another organisation, under one's own slug, is not found", async () => {
    const douala = await organisationOf("mairie-douala", fakeE164(1));
    const yaounde = await organisationOf("mairie-yaounde", fakeE164(5));
    const invited = await kit
      .client(douala.token)
      .query(INVITE_MEMBER_MUTATION, {
        variables: {
          slug: "mairie-douala",
          phone: fakePhone(2),
          role: "AGENT",
        },
      });
    const memberId = invited.data?.inviteMember.member.id as string;
    const as = kit.client(yaounde.token);
    const code = "organisations.errors.member-not-found";
    expect(
      codeOf(
        await as.query(SET_MEMBER_ROLE_MUTATION, {
          variables: { slug: "mairie-yaounde", memberId, role: "ADMIN" },
        }),
      ),
    ).toBe(code);
    expect(
      codeOf(
        await as.query(REMOVE_MEMBER_MUTATION, {
          variables: { slug: "mairie-yaounde", memberId },
        }),
      ),
    ).toBe(code);
  });
});

describe("the last administrator", () => {
  test("cannot be removed or demoted, until another one exists", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    const as = kit.client(admin.token);
    const members = await as.query(ORGANISATION_MEMBERS_QUERY, {
      variables: { slug: "mairie-douala" },
    });
    const own = members.data?.organisationMembers.edges[0]?.node.id as string;
    const slug = "mairie-douala";

    const removal = await as.query(REMOVE_MEMBER_MUTATION, {
      variables: { slug, memberId: own },
    });
    expect(codeOf(removal)).toBe("organisations.errors.last-admin");
    const demotion = await as.query(SET_MEMBER_ROLE_MUTATION, {
      variables: { slug, memberId: own, role: "AGENT" },
    });
    expect(codeOf(demotion)).toBe("organisations.errors.last-admin");

    const second = await invitedAs(admin, slug, fakeE164(2), "ADMIN");
    const demoted = await as.query(SET_MEMBER_ROLE_MUTATION, {
      variables: { slug, memberId: own, role: "AGENT" },
    });
    expect(demoted.errors).toBeUndefined();
    // The demoted admin is an agent now: refused an admin operation.
    const refused = await as.query(INVITE_MEMBER_MUTATION, {
      variables: { slug, phone: fakePhone(3), role: "AGENT" },
    });
    expect(codeOf(refused)).toBe("auth.errors.forbidden");
    // The new admin is the last one now.
    const lastOne = await kit
      .client(second.token)
      .query(REMOVE_MEMBER_MUTATION, {
        variables: { slug, memberId: second.memberId },
      });
    expect(codeOf(lastOne)).toBe("organisations.errors.last-admin");
  });

  test("a removed member loses access at once", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    const agent = await invitedAs(admin, "mairie-douala", fakeE164(2), "AGENT");
    const removed = await kit
      .client(admin.token)
      .query(REMOVE_MEMBER_MUTATION, {
        variables: { slug: "mairie-douala", memberId: agent.memberId },
      });
    expect(removed.data?.removeMember).toBe(agent.memberId);
    const read = await kit
      .client(agent.token)
      .query(ORGANISATION_QUERY, { variables: { slug: "mairie-douala" } });
    expect(codeOf(read)).toBe("organisations.errors.organisation-not-found");
  });
});

describe("phone numbers are masked", () => {
  test("no member read returns a whole number, to an administrator either", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    await invitedAs(admin, "mairie-douala", fakeE164(2), "AGENT");
    const raw = await kit.app.fetch(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rouvix-client": "spec",
          authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({
          query:
            '{ organisationMembers(slug: "mairie-douala") { edges { node { phoneMasked role status } } } }',
        }),
      }),
    );
    const text = await raw.text();
    expect(text).toContain("phoneMasked");
    expect(text).not.toContain("600000001");
    expect(text).not.toContain("600000002");
    expect(text).not.toContain("6 00 00 00");
    expect(text).toContain("+237");
  });
});

describe("a suspended account", () => {
  test("passes no guard", async () => {
    const admin = await organisationOf("mairie-douala", fakeE164(1));
    await kit.auth.accounts.update(admin.account, {
      suspendedAt: new Date().toISOString(),
    });
    const as = kit.client(admin.token);
    const created = await as.query(CREATE_ORGANISATION_MUTATION, {
      variables: { input: input("another") },
    });
    expect(codeOf(created)).toBe("accounts.errors.suspended");
    expect(created.status).toBe(403);
    const read = await as.query(ORGANISATION_QUERY, {
      variables: { slug: "mairie-douala" },
    });
    expect(codeOf(read)).toBe("accounts.errors.suspended");
    const members = await as.query(ORGANISATION_MEMBERS_QUERY, {
      variables: { slug: "mairie-douala" },
    });
    expect(codeOf(members)).toBe("accounts.errors.suspended");
  });
});
