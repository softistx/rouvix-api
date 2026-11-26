import { describe, expect, test } from "bun:test";
import { toConnection } from "./pagination";

describe("toConnection", () => {
  test("wraps a page, with the cursor it was asked with as its start", () => {
    const connection = toConnection(
      "c1",
      { items: ["a", "b"], nextCursor: "c2" },
      5,
    );
    expect(connection).toEqual({
      edges: [{ node: "a" }, { node: "b" }],
      totalCount: 5,
      pageInfo: {
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
  });

  test("a first page has no previous one, and a last page no next", () => {
    const connection = toConnection(
      null,
      { items: ["a"], nextCursor: null },
      1,
    );
    expect(connection.pageInfo).toEqual({
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });
});
