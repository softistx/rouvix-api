import { requireUser, requireViewer } from "@/auth/guards";
import type { Resolvers } from "@/generated/graphql/resolvers";

// Every operation is the signed-in account's own and calls `requireUser` first:
// nothing here reads another account's notice, setting or subscription.
export const notificationResolvers: Resolvers = {
  Query: {
    notifications: (_, { first, after }, ctx) =>
      ctx.services.notices.list(requireUser(ctx).id, { first, after }),
  },
  Viewer: {
    settings: (viewer, _, ctx) => {
      requireViewer(ctx);
      return ctx.services.settings.viewOf(viewer);
    },
  },
  Mutation: {
    markRead: (_, { ids }, ctx) =>
      ctx.services.notices.markRead(requireUser(ctx).id, ids),
    updateSettings: (_, { input }, ctx) =>
      ctx.services.settings.update(requireUser(ctx), {
        ...input,
        locale:
          input.locale === "EN" ? "en" : input.locale === "FR" ? "fr" : null,
      }),
    subscribePush: (_, { input }, ctx) =>
      ctx.services.subscriptions.subscribe(requireUser(ctx).id, input),
    unsubscribePush: (_, { endpoint }, ctx) =>
      ctx.services.subscriptions.unsubscribe(requireUser(ctx).id, endpoint),
  },
  Notification: {
    id: (notice) => notice._id.toHexString(),
    listingId: (notice) => notice.listingId?.toHexString() ?? null,
  },
  Settings: {
    locale: (settings) => (settings.locale === "en" ? "EN" : "FR"),
  },
};
