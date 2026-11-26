import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { listingsAs, lostContent } from "~/listings";

// Who may touch a listing: its author, and the agents of its organisation;
// nobody else, and a stranger cannot tell a draft exists.

const DECLARE_LISTING_MUTATION = graphql(`
  mutation DeclareAListing($input: DeclareListingInput!) {
    declareListing(input: $input) {
      id
      status
      organisationSlug
      version
    }
  }
`);

const UPDATE_LISTING_MUTATION = graphql(`
  mutation UpdateAListing($id: ID!, $input: ListingContentInput!, $version: Int!, $publish: Boolean!) {
    updateListing(id: $id, input: $input, version: $version, publish: $publish) {
      title
    }
  }
`);

const EXTEND_LISTING_MUTATION = graphql(`
  mutation ExtendAListing($id: ID!) {
    extendListing(id: $id) {
      extendedCount
    }
  }
`);

const CLOSE_LISTING_MUTATION = graphql(`
  mutation CloseAListing($id: ID!, $reason: CloseReason!) {
    closeListing(id: $id, reason: $reason) {
      status
    }
  }
`);

const REMOVE_LISTING_MUTATION = graphql(`
  mutation RemoveAListing($id: ID!) {
    removeListing(id: $id)
  }
`);

const MY_LISTING_QUERY = graphql(`
  query MyOwnListing($id: ID!) {
    myListing(id: $id) {
      id
      title
      organisationSlug
    }
  }
`);

const PUBLIC_LISTING_QUERY = graphql(`
  query PublicListingQuery($id: ID!) {
    listing(id: $id) {
      id
      organisationSlug
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const NOT_FOUND = "listings.errors.listing-not-found";
const input = { kind: "LOST" as const, content: lostContent(), publish: true };

describe("another account", () => {
  test("reads, edits, extends, closes and removes nothing of someone else's listing", async () => {
    const [owner, stranger] = [
      await signedIn(kit, { phone: "+237600000001" }),
      await signedIn(kit, { phone: "+237600000002" }),
    ];
    const declared = await kit
      .client(owner.token)
      .query(DECLARE_LISTING_MUTATION, { variables: { input } });
    const { id, version } = (declared.data?.declareListing ?? {}) as {
      id: string;
      version: number;
    };
    const as = kit.client(stranger.token);
    expect(
      codeOf(await as.query(MY_LISTING_QUERY, { variables: { id } })),
    ).toBe(NOT_FOUND);
    expect(
      codeOf(
        await as.query(UPDATE_LISTING_MUTATION, {
          variables: { id, input: lostContent(), version, publish: false },
        }),
      ),
    ).toBe(NOT_FOUND);
    expect(
      codeOf(await as.query(EXTEND_LISTING_MUTATION, { variables: { id } })),
    ).toBe(NOT_FOUND);
    expect(
      codeOf(
        await as.query(CLOSE_LISTING_MUTATION, {
          variables: { id, reason: "OTHER" },
        }),
      ),
    ).toBe(NOT_FOUND);
    expect(
      codeOf(await as.query(REMOVE_LISTING_MUTATION, { variables: { id } })),
    ).toBe(NOT_FOUND);
    expect(
      codeOf(await kit.client().query(MY_LISTING_QUERY, { variables: { id } })),
    ).toBe("auth.errors.unauthenticated");
    const untouched = await kit
      .client(owner.token)
      .query(MY_LISTING_QUERY, { variables: { id } });
    expect(untouched.data?.myListing.title).toBe("Téléphone noir perdu");
  });

  test("a malformed id and an unknown one are the same answer", async () => {
    const { token } = await signedIn(kit);
    for (const id of ["nope", "6740a0000000000000000001"]) {
      expect(
        codeOf(
          await kit
            .client(token)
            .query(MY_LISTING_QUERY, { variables: { id } }),
        ),
      ).toBe(NOT_FOUND);
      expect(
        codeOf(
          await kit.client().query(PUBLIC_LISTING_QUERY, { variables: { id } }),
        ),
      ).toBe(NOT_FOUND);
    }
  });
});

describe("an organisation's register", () => {
  async function register() {
    const admin = await listingsAs(kit, 1);
    const organisation = await admin.services.organisations.create(
      admin.viewer,
      {
        name: "Mairie de test",
        kind: "TOWN_HALL",
        slug: "mairie-de-test",
        city: "Douala",
      },
    );
    const agent = await listingsAs(kit, 2);
    const { token } = await admin.services.members.invite(
      admin.viewer,
      organisation._id,
      { phone: agent.viewer.phone, role: "AGENT" },
    );
    await agent.services.members.accept(agent.viewer, token);
    return { admin, agent, slug: organisation.slug };
  }

  test("an agent declares for it, and the organisation's other agents and admins edit it", async () => {
    const { admin, agent, slug } = await register();
    const declared = await kit
      .client(agent.token)
      .query(DECLARE_LISTING_MUTATION, {
        variables: { input: { ...input, organisationSlug: slug } },
      });
    expect(declared.data?.declareListing.organisationSlug).toBe(slug);
    const { id } = (declared.data?.declareListing ?? {}) as { id: string };
    const asAdmin = await kit
      .client(admin.token)
      .query(EXTEND_LISTING_MUTATION, { variables: { id } });
    expect(asAdmin.data?.extendListing.extendedCount).toBe(1);
    expect(
      (
        await kit
          .client(admin.token)
          .query(MY_LISTING_QUERY, { variables: { id } })
      ).data?.myListing.organisationSlug,
    ).toBe(slug);
    expect(
      (await kit.client().query(PUBLIC_LISTING_QUERY, { variables: { id } }))
        .data?.listing.organisationSlug,
    ).toBe(slug);
  });

  test("a non-member cannot declare for it, nor edit its listings", async () => {
    const { agent, slug } = await register();
    const outsider = await signedIn(kit, { phone: "+237600000003" });
    const refused = await kit
      .client(outsider.token)
      .query(DECLARE_LISTING_MUTATION, {
        variables: { input: { ...input, organisationSlug: slug } },
      });
    expect(codeOf(refused)).toBe("organisations.errors.organisation-not-found");
    const declared = await kit
      .client(agent.token)
      .query(DECLARE_LISTING_MUTATION, {
        variables: { input: { ...input, organisationSlug: slug } },
      });
    const { id } = (declared.data?.declareListing ?? {}) as { id: string };
    expect(
      codeOf(
        await kit.client(outsider.token).query(CLOSE_LISTING_MUTATION, {
          variables: { id, reason: "OTHER" },
        }),
      ),
    ).toBe(NOT_FOUND);
  });

  test("a removed agent loses the register's listings", async () => {
    const { admin, agent, slug } = await register();
    const declared = await kit
      .client(admin.token)
      .query(DECLARE_LISTING_MUTATION, {
        variables: { input: { ...input, organisationSlug: slug } },
      });
    const { id } = (declared.data?.declareListing ?? {}) as { id: string };
    expect(
      (
        await kit
          .client(agent.token)
          .query(MY_LISTING_QUERY, { variables: { id } })
      ).errors,
    ).toBeUndefined();
    const [member] = (
      await admin.services.members.list(
        (
          await admin.services.organisations.bySlug(slug)
        )?._id as never,
        { first: 10, after: null },
      )
    ).edges.filter((e) => e.node.accountId === agent.viewer.id);
    await admin.services.members.remove(
      (await admin.services.organisations.bySlug(slug))?._id as never,
      String(member?.node._id),
    );
    expect(
      codeOf(
        await kit
          .client(agent.token)
          .query(MY_LISTING_QUERY, { variables: { id } }),
      ),
    ).toBe(NOT_FOUND);
  });
});
