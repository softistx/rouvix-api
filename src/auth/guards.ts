import type { ObjectId } from "mongodb";
import type { Context } from "@/http/context";
import { fail } from "@/shared/errors";

type GuardContext = Pick<Context, "viewer" | "access" | "organisations">;

// The signed-in viewer, or a 401.
export function requireViewer(ctx: Pick<Context, "viewer">) {
  if (!ctx.viewer) throw fail("auth.errors.unauthenticated", { status: 401 });
  return ctx.viewer;
}

// The signed-in viewer, when the account is not suspended: 401 without one,
// 403 `accounts.errors.suspended` for a suspended account, which passes no
// guard of this file. What every operation of an account calls first.
export function requireUser(ctx: Pick<Context, "viewer">) {
  const viewer = requireViewer(ctx);
  if (viewer.suspendedAt !== null) {
    throw fail("accounts.errors.suspended", { status: 403 });
  }
  return viewer;
}

// The organisation `slug` names, when the viewer works in it: `requireUser`'s
// refusals, then 404 `organisations.errors.organisation-not-found` for a slug
// that names no organisation AND for one the viewer is no member of, so
// nothing tells an outsider an organisation exists. What every read of an
// organisation's data calls first (an agent's right; an admin has it too).
export async function requireOrgAgent(ctx: GuardContext, slug: string) {
  const viewer = requireUser(ctx);
  const organisation = await ctx.organisations.bySlug(slug);
  if (
    organisation === undefined ||
    !(await ctx.access.isOrgAgent(viewer, organisation._id))
  ) {
    throw fail("organisations.errors.organisation-not-found", { status: 404 });
  }
  return { viewer, organisation };
}

// The organisation `slug` names, when the viewer administers it:
// requireOrgAgent's refusals, then 403 `auth.errors.forbidden` for a member
// who is only an agent.
export async function requireOrgAdmin(ctx: GuardContext, slug: string) {
  const found = await requireOrgAgent(ctx, slug);
  if (!(await ctx.access.isOrgAdmin(found.viewer, found.organisation._id))) {
    throw fail("auth.errors.forbidden", { status: 403 });
  }
  return found;
}

// Whether the viewer administers the organisation, for what a flag needs after
// `requireOrgAgent` has refused whoever may not even read. Refuses nothing.
export const isAdminOf = (
  ctx: Pick<GuardContext, "viewer" | "access">,
  organisationId: ObjectId,
) => ctx.access.isOrgAdmin(requireUser(ctx), organisationId);

// The viewer, when the platform named them a moderator (a platform admin is
// one): requireUser's refusals, then 403.
export async function requireModerator(ctx: GuardContext) {
  const viewer = requireUser(ctx);
  if (!(await ctx.access.isModerator(viewer))) {
    throw fail("auth.errors.forbidden", { status: 403 });
  }
  return viewer;
}

// The viewer, when they are the platform's admin: requireUser's refusals,
// then 403.
export async function requirePlatformAdmin(ctx: GuardContext) {
  const viewer = requireUser(ctx);
  if (!(await ctx.access.isPlatformAdmin(viewer))) {
    throw fail("auth.errors.forbidden", { status: 403 });
  }
  return viewer;
}
