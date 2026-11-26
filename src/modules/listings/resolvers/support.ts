import {
  requireListingEditor,
  requireOrgAgent,
  requireUser,
} from "@/auth/guards";
import type { Context } from "@/http/context";
import { listingIdOf } from "../listings.errors";

// The guard-then-services call of the author's operations: the listing the
// viewer may edit (404 for any other), and the viewer.
export async function editorOf(ctx: Context, id: string) {
  return requireListingEditor(ctx, () =>
    ctx.services.listings.findLive(listingIdOf(id)),
  );
}

// The organisation a declaration joins, when it names one the viewer is an
// agent of; the viewer is signed in either way.
export async function declarer(ctx: Context, slug: string | null | undefined) {
  if (slug === null || slug === undefined) {
    return { viewer: requireUser(ctx), orgId: null };
  }
  const { viewer, organisation } = await requireOrgAgent(ctx, slug);
  return { viewer, orgId: organisation._id };
}
