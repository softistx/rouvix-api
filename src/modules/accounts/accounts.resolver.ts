import type { Resolvers } from "@/generated/graphql/resolvers";

// The `Viewer` is the viewer document itself, the `Account` too: `Account` is
// reachable through `Viewer.account` only, so it is always the caller's own.
export const accountResolvers: Resolvers = {
  Query: {
    viewer: (_, __, ctx) => ctx.viewer,
  },
  Viewer: {
    account: (viewer) => viewer,
    roles: (viewer, _, ctx) => ctx.services.accounts.roles(viewer),
  },
  Account: {
    displayName: (account) => account.name,
    emailVerified: (account) => account.emailVerifiedAt !== null,
    locale: (account) => (account.locale === "en" ? "EN" : "FR"),
  },
};
