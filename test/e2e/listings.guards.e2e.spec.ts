import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { lostContent } from "~/listings";

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

const REMOVE_LISTING_MUTATION = graphql(`
  mutation RemoveListing($id: ID!) {
    removeListing(id: $id)
  }
`);

const MY_LISTING_QUERY = graphql(`
  query MyListing($id: ID!) {
    myListing(id: $id) {
      id
      title
      version
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

describe("validation and guards", () => {
  test("an anonymous visitor declares nothing, a suspended account neither", async () => {
    const input = { kind: "LOST" as const, content: asInput(lostContent()) };
    expect(
      codeOf(
        await kit
          .client()
          .query(DECLARE_LISTING_MUTATION, { variables: { input } }),
      ),
    ).toBe("auth.errors.unauthenticated");
    const { account, token } = await signedIn(kit);
    await kit.auth.accounts.update(account, {
      suspendedAt: "2026-11-27T10:00:00.000Z",
    });
    expect(
      codeOf(
        await kit
          .client(token)
          .query(DECLARE_LISTING_MUTATION, { variables: { input } }),
      ),
    ).toBe("accounts.errors.suspended");
  });

  test("a content past the rules is one invalid-input, each issue on its path", async () => {
    const { token } = await signedIn(kit);
    const result = await kit.client(token).query(DECLARE_LISTING_MUTATION, {
      variables: {
        input: {
          kind: "LOST",
          content: asInput(
            lostContent({ categoryKey: "DOCUMENT", date: "2999-01-01" }),
          ),
        },
      },
    });
    expect(codeOf(result)).toBe("validation.errors.invalid-input");
    expect(result.status).toBe(400);
    const fields = result.errors?.[0]?.extensions?.["fields"] as {
      path: string;
      code: string;
    }[];
    expect(fields.map((f) => f.path).sort()).toEqual(["date", "documentType"]);
  });

  test("a radius, a title or a photo count past its @constraint is refused before any rule", async () => {
    const { token } = await signedIn(kit);
    const tooMany = Array.from(
      { length: 6 },
      (_, i) => `0000000${i}-0000-4000-8000-000000000000`,
    );
    for (const content of [
      lostContent({
        place: {
          label: "x",
          point: { latitude: 4, longitude: 9 },
          radiusM: 100,
        },
      }),
      lostContent({ title: "ab" }),
      lostContent({ photoKeys: tooMany }),
    ]) {
      const result = await kit.client(token).query(DECLARE_LISTING_MUTATION, {
        variables: { input: { kind: "LOST", content: asInput(content) } },
      });
      expect(codeOf(result)).toBe("validation.errors.invalid-input");
    }
  });

  test("an update with a stale version is 409, a removed listing is gone", async () => {
    const me = await signedIn(kit);
    const as = kit.client(me.token);
    const declared = await as.query(DECLARE_LISTING_MUTATION, {
      variables: { input: { kind: "LOST", content: asInput(lostContent()) } },
    });
    const { id, version } = (declared.data?.declareListing ?? {}) as {
      id: string;
      version: number;
    };
    await as.query(UPDATE_LISTING_MUTATION, {
      variables: {
        id,
        input: asInput(lostContent({ title: "Un autre titre" })),
        version,
        publish: false,
      },
    });
    const stale = await as.query(UPDATE_LISTING_MUTATION, {
      variables: { id, input: asInput(lostContent()), version, publish: false },
    });
    expect(codeOf(stale)).toBe("listings.errors.stale-version");
    expect(stale.status).toBe(409);
    expect(
      (await as.query(REMOVE_LISTING_MUTATION, { variables: { id } })).data
        ?.removeListing,
    ).toBe(id);
    expect(
      codeOf(await as.query(MY_LISTING_QUERY, { variables: { id } })),
    ).toBe("listings.errors.listing-not-found");
  });
});
