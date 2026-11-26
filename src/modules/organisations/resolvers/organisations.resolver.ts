import { requireOrgAgent, requireUser } from "@/auth/guards";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { maskPhone } from "@/shared/phone";
import { adminServices } from "./support";

// Neither `createOrganisation` nor `acceptMembership` is counted against a
// Throttle yet: the Throttle port (spec §3) arrives with the sign-in slice, with
// a per-account cap on organisations. The invitation token is 256 bits.
export const organisationResolvers: Resolvers = {
  Viewer: {
    organisations: async (viewer, _, ctx) => {
      requireUser(ctx);
      return ctx.services.organisations.ofViewer(viewer);
    },
  },
  Query: {
    organisation: async (_, { slug }, ctx) =>
      (await requireOrgAgent(ctx, slug)).organisation,
    organisationMembers: async (_, { slug, first, after }, ctx) => {
      const { organisation, members } = await adminServices(ctx, slug);
      return members.list(organisation._id, { first, after });
    },
  },
  Mutation: {
    createOrganisation: (_, { input }, ctx) =>
      ctx.services.organisations.create(requireUser(ctx), input),
    inviteMember: async (_, { slug, phone, role }, ctx) => {
      const { viewer, organisation, members } = await adminServices(ctx, slug);
      return members.invite(viewer, organisation._id, { phone, role });
    },
    acceptMembership: async (_, { token }, ctx) => {
      const viewer = requireUser(ctx);
      const { organisation, member } = await ctx.services.members.accept(
        viewer,
        token,
      );
      return { organisation, role: member.role };
    },
    setMemberRole: async (_, { slug, memberId, role }, ctx) => {
      const { organisation, members } = await adminServices(ctx, slug);
      return members.setRole(organisation._id, memberId, role);
    },
    removeMember: async (_, { slug, memberId }, ctx) => {
      const { organisation, members } = await adminServices(ctx, slug);
      return members.remove(organisation._id, memberId);
    },
  },
  Organisation: {
    id: (organisation) => organisation._id.toHexString(),
  },
  Member: {
    id: (member) => member._id.toHexString(),
    phoneMasked: (member) => maskPhone(member.phone),
  },
};
