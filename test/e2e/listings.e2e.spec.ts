import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { foundContent, lostContent, photoOf } from "~/listings";

// declare lost -> publish -> a visitor reads the masked view -> the author
// extends and closes, through the REAL janus and the media routes over the
// in-memory bucket.

const DECLARE_LISTING_MUTATION = graphql(`
  mutation DeclareListing($input: DeclareListingInput!) {
    declareListing(input: $input) {
      id
      kind
      status
      version
      expiresAt
      extendedCount
      photos { key status }
      place { label radiusM keptAt point { latitude longitude } }
      questions { prompt answer }
    }
  }
`);

const UPDATE_LISTING_MUTATION = graphql(`
  mutation UpdateListing($id: ID!, $input: ListingContentInput!, $version: Int!, $publish: Boolean!) {
    updateListing(id: $id, input: $input, version: $version, publish: $publish) {
      id
      status
      title
      version
    }
  }
`);

const EXTEND_LISTING_MUTATION = graphql(`
  mutation ExtendListing($id: ID!) {
    extendListing(id: $id) {
      status
      extendedCount
      expiresAt
    }
  }
`);

const CLOSE_LISTING_MUTATION = graphql(`
  mutation CloseListing($id: ID!, $reason: CloseReason!) {
    closeListing(id: $id, reason: $reason) {
      status
      closedReason
      closedAt
    }
  }
`);

const LISTING_QUERY = graphql(`
  query ListingQuery($id: ID!) {
    listing(id: $id) {
      id
      kind
      categoryKey
      title
      description
      photoKeys
      status
      date
      place { label radiusM keptAt point { latitude longitude } }
      attributes { colours brand }
    }
  }
`);

const MY_LISTINGS_QUERY = graphql(`
  query MyListings($first: Int) {
    myListings(first: $first) {
      totalCount
      edges { node { id title status } }
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

const asInput = (content: ReturnType<typeof lostContent>) => ({
  ...content,
  description: content.description,
});

describe("the slice's flow", () => {
  test("declare lost, publish, a visitor reads it masked, the author extends and closes", async () => {
    const me = await signedIn(kit, { phone: fakeE164(1) });
    const photo = await photoOf(kit, me.token);
    const as = kit.client(me.token);

    const declared = await as.query(DECLARE_LISTING_MUTATION, {
      variables: {
        input: {
          kind: "LOST",
          content: asInput(lostContent({ photoKeys: [photo] })),
        },
      },
    });
    expect(declared.errors).toBeUndefined();
    const draft = declared.data?.declareListing;
    expect(draft).toMatchObject({
      kind: "LOST",
      status: "DRAFT",
      extendedCount: 0,
      expiresAt: null,
    });
    expect(draft?.place.point).toEqual({
      latitude: 4.05123,
      longitude: 9.70456,
    });
    const id = draft?.id as string;

    expect(
      codeOf(await kit.client().query(LISTING_QUERY, { variables: { id } })),
    ).toBe("listings.errors.listing-not-found");

    const published = await as.query(UPDATE_LISTING_MUTATION, {
      variables: {
        id,
        input: asInput(lostContent({ photoKeys: [photo] })),
        version: draft?.version as number,
        publish: true,
      },
    });
    expect(published.data?.updateListing.status).toBe("PENDING");
    await kit.auth.background.settled();

    const seen = await kit.client().query(LISTING_QUERY, { variables: { id } });
    expect(seen.errors).toBeUndefined();
    expect(seen.data?.listing).toMatchObject({
      kind: "LOST",
      title: "Téléphone noir perdu",
      status: "OPEN",
      photoKeys: [photo],
      place: {
        radiusM: 500,
        keptAt: null,
        point: { latitude: 4.051, longitude: 9.705 },
      },
    });

    const extended = await as.query(EXTEND_LISTING_MUTATION, {
      variables: { id },
    });
    expect(extended.data?.extendListing.extendedCount).toBe(1);
    const closed = await as.query(CLOSE_LISTING_MUTATION, {
      variables: { id, reason: "RECOVERED" },
    });
    expect(closed.data?.closeListing).toMatchObject({
      status: "CLOSED",
      closedReason: "RECOVERED",
    });
    expect(
      codeOf(await kit.client().query(LISTING_QUERY, { variables: { id } })),
    ).toBe("listings.errors.listing-not-found");

    const mine = await as.query(MY_LISTINGS_QUERY, {
      variables: { first: 10 },
    });
    expect(mine.data?.myListings.edges.map((e) => e.node.status)).toEqual([
      "CLOSED",
    ]);
  });

  test("a found item keeps its questions to its finder and is shown blurred", async () => {
    const me = await signedIn(kit, { phone: fakeE164(1) });
    const as = kit.client(me.token);
    const declared = await as.query(DECLARE_LISTING_MUTATION, {
      variables: {
        input: {
          kind: "FOUND",
          content: asInput(foundContent()),
          publish: true,
        },
      },
    });
    expect(declared.data?.declareListing).toMatchObject({
      status: "OPEN",
      questions: [{ prompt: "Quelle initiale est brodée ?", answer: "Z" }],
    });
    const id = declared.data?.declareListing.id as string;
    const seen = await kit.client().query(LISTING_QUERY, { variables: { id } });
    expect(seen.data?.listing.place).toEqual({
      label: null,
      radiusM: null,
      keptAt: "WITH_FINDER",
      point: { latitude: 3.848, longitude: 11.502 },
    });
  });

  test("an item at a police station is shown where it is", async () => {
    const me = await signedIn(kit, { phone: fakeE164(1) });
    const content = foundContent({
      place: {
        label: "Commissariat de test",
        point: { latitude: 3.84812, longitude: 11.50234 },
        keptAt: "AT_POLICE",
      },
    });
    const declared = await kit
      .client(me.token)
      .query(DECLARE_LISTING_MUTATION, {
        variables: {
          input: { kind: "FOUND", content: asInput(content), publish: true },
        },
      });
    const seen = await kit.client().query(LISTING_QUERY, {
      variables: { id: declared.data?.declareListing.id as string },
    });
    expect(seen.data?.listing.place.point).toEqual({
      latitude: 3.84812,
      longitude: 11.50234,
    });
  });
});
