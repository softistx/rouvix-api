import { beforeEach, describe, expect, test } from "bun:test";
import { authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { graphql } from "~/generated/graphql";
import { memoryThrottle } from "~/throttle";

const SEARCH = graphql(`
  query ThrottledSearch { searchListings(first: 1) { totalCount } }
`);
const MAP = graphql(`
  query ThrottledMap($bbox: BoundingBoxInput!) {
    mapListings(bbox: $bbox) { truncated }
  }
`);
const bbox = { south: 3.9, west: 9.6, north: 4.2, east: 9.9 };

beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
});

describe("visitor reads are throttled per address", () => {
  test("the search and the map share one budget; past it a 429 with the wait in minutes", async () => {
    const throttle = memoryThrottle(3, 90);
    const kit = authApp({ throttle });
    const as = kit.client();
    expect((await as.query(SEARCH)).errors).toBeUndefined();
    expect(
      (await as.query(MAP, { variables: { bbox } })).errors,
    ).toBeUndefined();
    expect((await as.query(SEARCH)).errors).toBeUndefined();
    const refused = await as.query(SEARCH);
    expect(codeOf(refused)).toBe("throttle.errors.too-many");
    expect(refused.errors?.[0]?.extensions).toMatchObject({
      params: { retryAfter: 90, minutes: 2 },
    });
    expect(codeOf(await as.query(MAP, { variables: { bbox } }))).toBe(
      "throttle.errors.too-many",
    );
    expect(throttle.keys()).toEqual(["visitor-read:unknown"]);
  });
});
