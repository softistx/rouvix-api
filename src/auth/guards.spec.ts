import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { refusal } from "~/refusals";
import type { Access, Viewer } from "./access";
import {
  isAdminOf,
  requireModerator,
  requireOrgAdmin,
  requireOrgAgent,
  requirePlatformAdmin,
  requireUser,
  requireViewer,
} from "./guards";

const organisation = { _id: new ObjectId(), slug: "mairie" };
const viewer = (suspendedAt: Date | null = null): Viewer => ({
  id: "01933333-3333-7333-8333-333333333333",
  type: "user",
  name: "Test",
  phone: "+237600000001",
  locale: "fr",
  countryCode: "CM",
  trustScore: 50,
  finderBadge: false,
  suspendedAt,
  createdAt: new Date(),
});

// An access that grants what is listed, and a directory that knows `mairie`.
const ctx = (
  who: Viewer | null,
  held: Partial<Record<keyof Access, boolean>> = {},
) => ({
  viewer: who,
  access: {
    isOrgAgent: async () => held.isOrgAgent ?? false,
    isOrgAdmin: async () => held.isOrgAdmin ?? false,
    isModerator: async () => held.isModerator ?? false,
    isPlatformAdmin: async () => held.isPlatformAdmin ?? false,
  } satisfies Access,
  organisations: {
    bySlug: async (slug: string) =>
      slug === "mairie" ? (organisation as never) : undefined,
  },
});

const codeOf = async (promise: Promise<unknown>) =>
  (await refusal(promise)).extensions["code"];
const statusOf = async (promise: Promise<unknown>) =>
  (await refusal(promise)).extensions["http"];

describe("requireViewer and requireUser", () => {
  test("no viewer is a 401", () => {
    expect(() => requireViewer({ viewer: null })).toThrow();
    return expect(
      codeOf(Promise.resolve().then(() => requireUser({ viewer: null }))),
    ).resolves.toBe("auth.errors.unauthenticated");
  });

  test("a suspended account is refused with accounts.errors.suspended, 403", async () => {
    const suspended = viewer(new Date());
    const attempt = () =>
      Promise.resolve().then(() => requireUser({ viewer: suspended }));
    expect(await codeOf(attempt())).toBe("accounts.errors.suspended");
    expect(await statusOf(attempt())).toEqual({ status: 403 });
  });

  test("a signed-in account passes", () => {
    const who = viewer();
    expect(requireUser({ viewer: who })).toBe(who);
  });
});

describe("requireOrgAgent and requireOrgAdmin", () => {
  test("an unknown slug and a non-member are the same 404", async () => {
    const outsider = ctx(viewer());
    expect(await codeOf(requireOrgAgent(outsider, "nowhere"))).toBe(
      "organisations.errors.organisation-not-found",
    );
    expect(await codeOf(requireOrgAgent(outsider, "mairie"))).toBe(
      "organisations.errors.organisation-not-found",
    );
    expect(await statusOf(requireOrgAgent(outsider, "mairie"))).toEqual({
      status: 404,
    });
  });

  test("an agent passes the agent guard and is forbidden the admin one", async () => {
    const agent = ctx(viewer(), { isOrgAgent: true });
    expect((await requireOrgAgent(agent, "mairie")).organisation).toBe(
      organisation as never,
    );
    expect(await codeOf(requireOrgAdmin(agent, "mairie"))).toBe(
      "auth.errors.forbidden",
    );
  });

  test("an admin passes both", async () => {
    const admin = ctx(viewer(), { isOrgAgent: true, isOrgAdmin: true });
    expect((await requireOrgAdmin(admin, "mairie")).organisation).toBe(
      organisation as never,
    );
    expect(await isAdminOf(admin, organisation._id)).toBe(true);
  });

  test("an anonymous request is a 401 before the organisation is read", async () => {
    expect(await codeOf(requireOrgAgent(ctx(null), "mairie"))).toBe(
      "auth.errors.unauthenticated",
    );
  });
});

describe("requireModerator and requirePlatformAdmin", () => {
  test("a moderator passes the first only, a platform admin the second", async () => {
    const moderator = ctx(viewer(), { isModerator: true });
    expect(await requireModerator(moderator)).toBeDefined();
    expect(await codeOf(requirePlatformAdmin(moderator))).toBe(
      "auth.errors.forbidden",
    );
    const owner = ctx(viewer(), { isModerator: true, isPlatformAdmin: true });
    expect(await requirePlatformAdmin(owner)).toBeDefined();
  });

  test("a plain account passes neither", async () => {
    expect(await codeOf(requireModerator(ctx(viewer())))).toBe(
      "auth.errors.forbidden",
    );
    expect(await codeOf(requirePlatformAdmin(ctx(viewer())))).toBe(
      "auth.errors.forbidden",
    );
  });
});

describe("a suspended account passes none", () => {
  const suspended = viewer(new Date());
  const all = {
    isOrgAgent: true,
    isOrgAdmin: true,
    isModerator: true,
    isPlatformAdmin: true,
  };
  const expected = "accounts.errors.suspended";

  test("not even with every right granted", async () => {
    const who = ctx(suspended, all);
    expect(await codeOf(requireOrgAgent(who, "mairie"))).toBe(expected);
    expect(await codeOf(requireOrgAdmin(who, "mairie"))).toBe(expected);
    expect(await codeOf(requireModerator(who))).toBe(expected);
    expect(await codeOf(requirePlatformAdmin(who))).toBe(expected);
  });
});
