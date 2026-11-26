import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase, resetConfig } from "~/db";
import { listingsAs } from "~/listings";
import { issuesOf } from "~/refusals";

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

async function twoAccounts() {
  const a = await listingsAs(kit, 1);
  const b = await listingsAs(kit, 2);
  return { a, b };
}

describe("list", () => {
  test("is the account's own, newest first, with its unread count", async () => {
    const { a, b } = await twoAccounts();
    const kinds = ["MATCH", "MESSAGE", "CLAIM"] as const;
    for (const kind of kinds) {
      await a.services.notifier.notify(a.account.id, { kind });
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    await b.services.notifier.notify(b.account.id, { kind: "MATCH" });
    await kit.auth.background.settled();
    const page = await a.services.notices.list(a.account.id, {
      first: 2,
      after: undefined,
    });
    expect(page.edges.map((edge) => edge.node.kind)).toEqual([
      "CLAIM",
      "MESSAGE",
    ]);
    expect(page).toMatchObject({ totalCount: 3, unreadCount: 3 });
    expect(page.pageInfo.hasNextPage).toBe(true);
    const next = await a.services.notices.list(a.account.id, {
      first: 2,
      after: page.pageInfo.endCursor,
    });
    expect(next.edges.map((edge) => edge.node.kind)).toEqual(["MATCH"]);
  });
});

describe("markRead", () => {
  test("marks the notices read and keeps the first date of one already read", async () => {
    const { a } = await twoAccounts();
    const first = await a.services.notifier.notify(a.account.id, {
      kind: "MATCH",
    });
    const second = await a.services.notifier.notify(a.account.id, {
      kind: "CLAIM",
    });
    const ids = [first, second].map(
      (notice) => notice?._id.toHexString() ?? "",
    );
    const [one] = await a.services.notices.markRead(a.account.id, [
      ids[0] ?? "",
    ]);
    const readAt = one?.readAt;
    expect(readAt).toBeInstanceOf(Date);
    kit.clock.advance(1000);
    const both = await a.services.notices.markRead(a.account.id, ids);
    expect(both.every((notice) => notice.readAt !== null)).toBe(true);
    expect(
      both.find((notice) => notice._id.toHexString() === ids[0])?.readAt,
    ).toEqual(readAt as Date);
    const page = await a.services.notices.list(a.account.id, {
      first: 10,
      after: undefined,
    });
    expect(page.unreadCount).toBe(0);
  });

  test("is all or none: another account's, an unknown and a malformed id refuse the call", async () => {
    const { a, b } = await twoAccounts();
    const mine = await a.services.notifier.notify(a.account.id, {
      kind: "MATCH",
    });
    const theirs = await b.services.notifier.notify(b.account.id, {
      kind: "MATCH",
    });
    const ids = [
      mine?._id.toHexString() ?? "",
      theirs?._id.toHexString() ?? "",
      "0123456789abcdef01234567",
      "not-an-id",
    ];
    const issues = await issuesOf(
      a.services.notices.markRead(a.account.id, ids),
    );
    expect(issues.map((issue) => issue.path)).toEqual([
      "ids.1",
      "ids.2",
      "ids.3",
    ]);
    expect(
      issues.every(
        (issue) => issue.code === "notifications.errors.notification-not-found",
      ),
    ).toBe(true);
    expect(await mongo.db.notifications.count({ readAt: { $ne: null } })).toBe(
      0,
    );
  });
});
