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

const ORGANISATION_QUERY = graphql(`
  query OrganisationBySlug($slug: String!) {
    organisation(slug: $slug) {
      id
      slug
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
