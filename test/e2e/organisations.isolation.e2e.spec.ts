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
