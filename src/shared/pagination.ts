import type { CursorPage } from "@softistx/mongo";

// A page as the schema's connections give it (src/graphql/common.graphqls):
// forward only, `startCursor` the `after` it was asked with.
export function toConnection<T>(
  after: string | null | undefined,
  page: CursorPage<T>,
  totalCount: number,
) {
  return {
    edges: page.items.map((node) => ({ node })),
    totalCount,
    pageInfo: {
      startCursor: after ?? null,
      endCursor: page.nextCursor,
      hasNextPage: page.nextCursor !== null,
      hasPreviousPage: after !== null && after !== undefined,
    },
  };
}
