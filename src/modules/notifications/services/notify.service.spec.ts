import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164 } from "~/fixtures";
import { documentContent, listingsAs, lostContent } from "~/listings";
import { fakeSubscription } from "~/push";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

async function recipient() {
  const me = await listingsAs(kit, 1);
  const verify = (email = "person@example.test") =>
    kit.auth.accounts.update(me.account.id, {
      email,
      emailVerifiedAt: new Date(kit.clock.now()).toISOString(),
    });
  const settings = (input: Parameters<typeof me.services.settings.update>[1]) =>
    me.services.settings.update(me.viewer, input);
  const subscribe = (n: number) =>
    me.services.subscriptions.subscribe(me.viewer.id, fakeSubscription(n));
  const notify = async (
    event: Parameters<typeof me.services.notifier.notify>[1],
  ) => {
    const notice = await me.services.notifier.notify(me.account.id, event);
    await kit.auth.background.settled();
    return notice;
  };
  return { me, verify, settings, subscribe, notify };
}

const listingOf = (
  me: Awaited<ReturnType<typeof listingsAs>>,
  content = lostContent(),
  kind: "LOST" | "FOUND" = "LOST",
) =>
  me.listings
    .declare(me.viewer, { ...content, kind, publish: true }, null)
    .then((listing) => listing._id.toHexString());

describe("notify", () => {
  test("always records the notice, whatever the settings", async () => {
    const { me, settings, notify } = await recipient();
    await settings({ notifyClaim: false });
    const notice = await notify({ kind: "CLAIM" });
    expect(notice).toMatchObject({ accountId: me.account.id, kind: "CLAIM" });
    expect(await mongo.db.notifications.count({})).toBe(1);
    expect(kit.push.sent).toEqual([]);
  });

  test("pushes to each browser with the generic words and no item detail", async () => {
    const { me, subscribe, notify } = await recipient();
    await subscribe(1);
    await subscribe(2);
    const listing = await listingOf(me);
    await notify({ kind: "MATCH", listingId: listing });
    expect(kit.push.sent.map((push) => push.target.endpoint).sort()).toEqual([
      fakeSubscription(1).endpoint,
      fakeSubscription(2).endpoint,
    ]);
    const payload = kit.push.sent[0]?.payload;
    expect(payload).toEqual({
      title: "Rouvix",
      body: "Un objet pourrait correspondre à une de vos annonces.",
      url: "/me",
    });
    expect(JSON.stringify(kit.push.sent)).not.toContain("Téléphone");
    expect(JSON.stringify(payload)).not.toContain(listing);
  });

  test("words the push in the account's language", async () => {
    const { me, settings, subscribe, notify } = await recipient();
    await settings({ locale: "en" });
    await subscribe(1);
    await notify({ kind: "MESSAGE" });
    expect(kit.push.sent[0]?.payload).toMatchObject({
      body: "You have a new message.",
      url: "/messages",
    });
    expect((await kit.auth.accounts.find(me.account.id))?.locale).toBe("en");
  });

  test("an event the account turned off sends no push and no mail", async () => {
    const { settings, subscribe, verify, notify } = await recipient();
    await verify();
    await subscribe(1);
    await settings({ notifyMessage: false, emailCopies: true });
    await notify({ kind: "MESSAGE" });
    expect(kit.push.sent).toEqual([]);
    expect(kit.mailer.sent).toEqual([]);
  });

  test("with previews on, an object's title and its page", async () => {
    const { me, settings, subscribe, notify } = await recipient();
    await subscribe(1);
    await settings({ pushPreviews: true });
    const listing = await listingOf(me);
    await notify({ kind: "MATCH", listingId: listing });
    expect(kit.push.sent[0]?.payload).toMatchObject({
      body: expect.stringContaining("Téléphone noir perdu"),
      url: `/items/${listing}`,
    });
  });

  test("with previews on, an ID document's title is still never sent", async () => {
    const { me, settings, subscribe, verify, notify } = await recipient();
    await verify();
    await subscribe(1);
    await settings({ pushPreviews: true, emailCopies: true });
    const draft = await me.listings.declare(
      me.viewer,
      { ...documentContent({ title: "CNI de Aïcha Test" }), kind: "FOUND" },
      null,
    );
    await notify({ kind: "CLAIM", listingId: draft._id.toHexString() });
    const everything = JSON.stringify([kit.push.sent, kit.mailer.sent]);
    expect(everything).not.toContain("Aïcha");
    expect(everything).not.toContain("CNI");
    expect(everything).not.toContain(draft._id.toHexString());
    expect(kit.push.sent[0]?.payload.url).toBe("/me");
  });

  test("with previews on, a title carrying a number is never sent", async () => {
    const { me, settings, subscribe, notify } = await recipient();
    await subscribe(1);
    await settings({ pushPreviews: true });
    const listing = await listingOf(
      me,
      lostContent({ title: "Téléphone, appeler le 6 00 00 00 99" }),
    );
    await notify({ kind: "MATCH", listingId: listing });
    expect(JSON.stringify(kit.push.sent)).not.toContain("00 00");
    expect(kit.push.sent[0]?.payload.body).not.toContain("«");
  });

  test("forgets a browser the push service says is gone, and survives one that fails", async () => {
    const { subscribe, notify } = await recipient();
    for (const n of [1, 2, 3]) await subscribe(n);
    kit.push.gone.add(fakeSubscription(1).endpoint);
    kit.push.failing.add(fakeSubscription(2).endpoint);
    await notify({ kind: "MESSAGE" });
    expect(kit.push.sent).toHaveLength(2);
    const left = await mongo.db.pushSubscriptions.raw.find({}).toArray();
    expect(left.map((row) => row.endpoint).sort()).toEqual([
      fakeSubscription(2).endpoint,
      fakeSubscription(3).endpoint,
    ]);
  });

  test("an e-mail copy goes to a verified address only, in the background", async () => {
    const { settings, verify, notify } = await recipient();
    await settings({ emailCopies: true });
    await notify({ kind: "CLAIM" });
    expect(kit.mailer.sent).toEqual([]);
    await kit.auth.accounts.update(
      (await kit.auth.accounts.findByLogin(fakeE164(1)))?.id ?? "",
      {
        email: "person@example.test",
      },
    );
    await notify({ kind: "CLAIM" });
    expect(kit.mailer.sent).toEqual([]);
    await verify();
    await notify({ kind: "CLAIM" });
    expect(kit.mailer.sent).toHaveLength(1);
    const mail = kit.mailer.sent[0];
    expect(mail?.to).toBe("person@example.test");
    expect(mail?.from).toBe("no-reply@rouvix.test");
    expect(mail?.text).toContain("http://localhost:5173/me");
  });

  test("no e-mail copy without the setting, though the address is verified", async () => {
    const { verify, notify } = await recipient();
    await verify();
    await notify({ kind: "CLAIM" });
    expect(kit.mailer.sent).toEqual([]);
  });

  test("a mailer that fails never fails the notice", async () => {
    const { settings, verify, notify } = await recipient();
    await verify();
    await settings({ emailCopies: true });
    const log = console.error;
    console.error = () => {};
    kit.mailer.failNext();
    try {
      expect(await notify({ kind: "CLAIM" })).not.toBeNull();
    } finally {
      console.error = log;
    }
    expect(await mongo.db.notifications.count({})).toBe(1);
  });

  test("a suspended account gets the notice and nothing else", async () => {
    const { me, subscribe, settings, verify, notify } = await recipient();
    await verify();
    await subscribe(1);
    await settings({ emailCopies: true });
    await kit.auth.accounts.update(me.account.id, {
      suspendedAt: new Date(kit.clock.now()).toISOString(),
    });
    expect(await notify({ kind: "MESSAGE" })).not.toBeNull();
    expect(kit.push.sent).toEqual([]);
    expect(kit.mailer.sent).toEqual([]);
  });

  test("an unknown account is told nothing, and nothing is recorded", async () => {
    const { me } = await recipient();
    expect(
      await me.services.notifier.notify(
        "01933333-3333-7333-8333-333333333333",
        {
          kind: "MESSAGE",
        },
      ),
    ).toBeNull();
    expect(await mongo.db.notifications.count({})).toBe(0);
  });
});
