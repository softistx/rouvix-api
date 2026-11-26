import { requireOrgAdmin } from "@/auth/guards";
import type { Context } from "@/http/context";

// The guard-then-services call of the administrators' operations: the
// organisation the viewer administers, and the members service.
export async function adminServices(ctx: Context, slug: string) {
  const { viewer, organisation } = await requireOrgAdmin(ctx, slug);
  return { viewer, organisation, members: ctx.services.members };
}
