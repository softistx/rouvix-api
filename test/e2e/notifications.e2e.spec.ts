import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { listingsAs } from "~/listings";
import { fakeSubscription } from "~/push";

const SETTINGS_QUERY = graphql(`
  query SettingsQuery {
    viewer {
      account {
        email
        emailVerified
      }
      settings {
        locale
        notifyMatch
        notifyMessage
        notifyClaim
        emailCopies
        pushPreviews
      }
    }
  }
`);

const UPDATE_SETTINGS_MUTATION = graphql(`
  mutation UpdateSettingsMutation($input: UpdateSettingsInput!) {
    updateSettings(input: $input) {
      locale
      notifyMatch
      emailCopies
      pushPreviews
    }
  }
`);

const NOTIFICATIONS_QUERY = graphql(`
  query NotificationsQuery($first: Int, $after: String) {
    notifications(first: $first, after: $after) {
      totalCount
      unreadCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          kind
          listingId
          readAt
        }
      }
    }
  }
`);

const MARK_READ_MUTATION = graphql(`
  mutation MarkReadMutation($ids: [ID!]!) {
    markRead(ids: $ids) {
      id
      readAt
    }
  }
`);

const SUBSCRIBE_PUSH_MUTATION = graphql(`
  mutation SubscribePushMutation($input: PushSubscriptionInput!) {
    subscribePush(input: $input)
  }
`);

const UNSUBSCRIBE_PUSH_MUTATION = graphql(`
  mutation UnsubscribePushMutation($endpoint: String!) {
    unsubscribePush(endpoint: $endpoint)
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
});

describe("guards", () => {
  test("every operation needs a signed-in account", async () => {
    const anonymous = kit.client();
    expect(codeOf(await anonymous.query(NOTIFICATIONS_QUERY))).toBe(
      "auth.errors.unauthenticated",
    );
    expect(
      codeOf(
        await anonymous.query(MARK_READ_MUTATION, {
          variables: { ids: ["x"] },
        }),
      ),
    ).toBe("auth.errors.unauthenticated");
    expect(
      codeOf(
        await anonymous.query(UPDATE_SETTINGS_MUTATION, {
          variables: {
            input: { notifyMatch: false },
          },
        }),
      ),
    ).toBe("auth.errors.unauthenticated");
    expect(
      codeOf(
        await anonymous.query(SUBSCRIBE_PUSH_MUTATION, {
          variables: {
            input: fakeSubscription(1),
          },
        }),
      ),
    ).toBe("auth.errors.unauthenticated");
    expect(
      codeOf(
        await anonymous.query(UNSUBSCRIBE_PUSH_MUTATION, {
          variables: { endpoint: "x" },
        }),
      ),
    ).toBe("auth.errors.unauthenticated");
  });

  test("a suspended account is refused", async () => {
    const { account, token } = await signedIn(kit);
    await kit.auth.accounts.update(account.id, {
      suspendedAt: new Date(kit.clock.now()).toISOString(),
    });
    const client = kit.client(token);
    expect(codeOf(await client.query(NOTIFICATIONS_QUERY))).toBe(
      "accounts.errors.suspended",
    );
    expect(
      codeOf(
        await client.query(UPDATE_SETTINGS_MUTATION, {
          variables: {
            input: { notifyMatch: false },
          },
        }),
      ),
    ).toBe("accounts.errors.suspended");
  });
});

describe("settings", () => {
  test("the defaults, then the fields saved, and the address verification state", async () => {
    const { account, token } = await signedIn(kit);
    const client = kit.client(token);
    const first = await client.query(SETTINGS_QUERY);
    expect(first.errors).toBeUndefined();
    expect(first.data?.viewer).toEqual({
      account: { email: null, emailVerified: false },
      settings: {
        locale: "FR",
        notifyMatch: true,
        notifyMessage: true,
        notifyClaim: true,
        emailCopies: false,
        pushPreviews: false,
      },
    });
    const saved = await client.query(UPDATE_SETTINGS_MUTATION, {
      variables: {
        input: { notifyMatch: false, pushPreviews: true, locale: "EN" },
      },
    });
    expect(saved.data?.updateSettings).toEqual({
      locale: "EN",
      notifyMatch: false,
      emailCopies: false,
      pushPreviews: true,
    });
    await kit.auth.accounts.update(account.id, {
      email: "person@example.test",
      emailVerifiedAt: new Date(kit.clock.now()).toISOString(),
    });
    const again = await client.query(SETTINGS_QUERY);
    expect(again.data?.viewer?.settings).toMatchObject({
      locale: "EN",
      notifyMatch: false,
      pushPreviews: true,
    });
    expect(again.data?.viewer?.account).toEqual({
      email: "person@example.test",
      emailVerified: true,
    });
  });
});

describe("notifications and markRead", () => {
  test("lists the account's own notices and marks them read, all or none", async () => {
    const me = await listingsAs(kit, 1);
    const other = await listingsAs(kit, 2);
    const a = await me.services.notifier.notify(me.account.id, {
      kind: "MATCH",
    });
    const b = await me.services.notifier.notify(me.account.id, {
      kind: "CLAIM",
    });
    const theirs = await other.services.notifier.notify(other.account.id, {
      kind: "MESSAGE",
    });
    const client = kit.client(me.token);
    const list = await client.query(NOTIFICATIONS_QUERY, {
      variables: { first: 10 },
    });
    expect(list.data?.notifications).toMatchObject({
      totalCount: 2,
      unreadCount: 2,
    });
    expect(
      list.data?.notifications.edges.map((edge) => edge.node.kind).sort(),
    ).toEqual(["CLAIM", "MATCH"]);

    const refused = await client.query(MARK_READ_MUTATION, {
      variables: {
        ids: [a?._id.toHexString() ?? "", theirs?._id.toHexString() ?? ""],
      },
    });
    expect(codeOf(refused)).toBe("notifications.errors.notification-not-found");
    expect(
      (await client.query(NOTIFICATIONS_QUERY)).data?.notifications.unreadCount,
    ).toBe(2);

    const done = await client.query(MARK_READ_MUTATION, {
      variables: {
        ids: [a?._id.toHexString() ?? "", b?._id.toHexString() ?? ""],
      },
    });
    expect(done.data?.markRead.every((notice) => notice.readAt !== null)).toBe(
      true,
    );
    expect(
      (await client.query(NOTIFICATIONS_QUERY)).data?.notifications.unreadCount,
    ).toBe(0);
    const stillUnread = await kit
      .client(other.token)
      .query(NOTIFICATIONS_QUERY);
    expect(stillUnread.data?.notifications.unreadCount).toBe(1);
  });

  test("markRead takes a hundred ids at most", async () => {
    const { token } = await signedIn(kit, { phone: fakeE164(3) });
    const result = await kit.client(token).query(MARK_READ_MUTATION, {
      variables: {
        ids: Array.from({ length: 101 }, () => "0123456789abcdef01234567"),
      },
    });
    expect(codeOf(result)).toBe("validation.errors.invalid-input");
  });
});

describe("push subscriptions", () => {
  test("subscribe, then unsubscribe", async () => {
    const { token } = await signedIn(kit);
    const client = kit.client(token);
    const subscribed = await client.query(SUBSCRIBE_PUSH_MUTATION, {
      variables: {
        input: fakeSubscription(1),
      },
    });
    expect(subscribed.data?.subscribePush).toBe(true);
    const gone = await client.query(UNSUBSCRIBE_PUSH_MUTATION, {
      variables: {
        endpoint: fakeSubscription(1).endpoint,
      },
    });
    expect(gone.data?.unsubscribePush).toBe(true);
    const again = await client.query(UNSUBSCRIBE_PUSH_MUTATION, {
      variables: {
        endpoint: fakeSubscription(1).endpoint,
      },
    });
    expect(again.data?.unsubscribePush).toBe(false);
  });

  test("an endpoint on the private network is refused", async () => {
    const { token } = await signedIn(kit);
    const result = await kit.client(token).query(SUBSCRIBE_PUSH_MUTATION, {
      variables: {
        input: { ...fakeSubscription(1), endpoint: "https://10.0.0.5/send" },
      },
    });
    expect(codeOf(result)).toBe("validation.errors.invalid-input");
  });
});
