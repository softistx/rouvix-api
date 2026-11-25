import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { signedIn } from "~/fixtures";
import { janusAccess, janusViewer, PLATFORM, viewerOf } from "./access";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
});

describe("janusAccess", () => {
  test("a plain account holds nothing", async () => {
    const { account } = await signedIn(kit);
    const access = janusAccess(kit.auth);
    const viewer = viewerOf(account);
    expect(await access.isModerator(viewer)).toBe(false);
    expect(await access.isPlatformAdmin(viewer)).toBe(false);
    expect(await access.isOrgAgent(viewer, new ObjectId())).toBe(false);
    expect(await access.isOrgAdmin(viewer, new ObjectId())).toBe(false);
  });

  test("a platform admin is a moderator, a moderator no admin", async () => {
    const [owner, moderator] = [
      await signedIn(kit, { phone: "+237600000001" }),
      await signedIn(kit, { phone: "+237600000002" }),
    ];
    const grant = (id: string, relation: "admins" | "moderators") =>
      kit.auth.permissions.grant(PLATFORM, relation, { type: "user", id });
    await grant(owner.account.id, "admins");
    await grant(moderator.account.id, "moderators");
    const access = janusAccess(kit.auth);
    expect(await access.isPlatformAdmin(viewerOf(owner.account))).toBe(true);
    expect(await access.isModerator(viewerOf(owner.account))).toBe(true);
    expect(await access.isModerator(viewerOf(moderator.account))).toBe(true);
    expect(await access.isPlatformAdmin(viewerOf(moderator.account))).toBe(
      false,
    );
  });

  test("an organisation's relations give nothing in another organisation or on the platform", async () => {
    const { account } = await signedIn(kit);
    const [a, b] = [new ObjectId(), new ObjectId()];
    await kit.auth.permissions.grant(
      { type: "organisation", id: a.toHexString() },
      "admins",
      { type: "user", id: account.id },
    );
    const access = janusAccess(kit.auth);
    const viewer = viewerOf(account);
    expect(await access.isOrgAdmin(viewer, a)).toBe(true);
    expect(await access.isOrgAgent(viewer, a)).toBe(true);
    expect(await access.isOrgAgent(viewer, b)).toBe(false);
    expect(await access.isPlatformAdmin(viewer)).toBe(false);
  });
});

describe("janusViewer", () => {
  test("reads the account from the bearer token, and none without one", async () => {
    const { account, token } = await signedIn(kit);
    const read = janusViewer(kit.auth);
    const bearer = new Request("http://localhost/graphql", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await read(bearer)).toMatchObject({
      id: account.id,
      phone: account.phone,
      suspendedAt: null,
    });
    expect(await read(new Request("http://localhost/graphql"))).toBeNull();
  });

  test("carries the suspension date of a suspended account", async () => {
    const { account, token } = await signedIn(kit);
    await kit.auth.accounts.update(account, {
      suspendedAt: "2026-11-25T10:00:00.000Z",
    });
    const viewer = await janusViewer(kit.auth)(
      new Request("http://localhost/graphql", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(viewer?.suspendedAt?.toISOString()).toBe("2026-11-25T10:00:00.000Z");
  });
});
