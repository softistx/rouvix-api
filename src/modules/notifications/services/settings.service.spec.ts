import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { listingsAs } from "~/listings";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

describe("settings", () => {
  test("an account that never saved holds the defaults and its own language", async () => {
    const me = await listingsAs(kit);
    expect(await me.services.settings.viewOf(me.viewer)).toEqual({
      locale: "fr",
      notifyMatch: true,
      notifyMessage: true,
      notifyClaim: true,
      emailCopies: false,
      pushPreviews: false,
    });
  });

  test("saves the fields given and keeps the others, per account", async () => {
    const me = await listingsAs(kit, 1);
    const other = await listingsAs(kit, 2);
    await me.services.settings.update(me.viewer, { notifyMatch: false });
    const saved = await me.services.settings.update(me.viewer, {
      pushPreviews: true,
      emailCopies: null,
    });
    expect(saved).toMatchObject({
      notifyMatch: false,
      pushPreviews: true,
      emailCopies: false,
    });
    expect(await me.services.settings.of(me.viewer.id)).toMatchObject({
      notifyMatch: false,
      pushPreviews: true,
    });
    expect(await other.services.settings.of(other.viewer.id)).toMatchObject({
      notifyMatch: true,
      pushPreviews: false,
    });
  });

  test("the language is janus's, changed with the settings", async () => {
    const me = await listingsAs(kit);
    const saved = await me.services.settings.update(me.viewer, {
      locale: "en",
    });
    expect(saved.locale).toBe("en");
    expect((await kit.auth.accounts.find(me.viewer.id))?.locale).toBe("en");
  });
});
