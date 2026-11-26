import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { clearDatabase } from "~/db";
import { fakeSubscription } from "~/push";
import { issuesOf, refusal } from "~/refusals";
import { PushSubscriptions } from "./push-subscriptions.service";

const ME = "01933333-3333-7333-8333-333333333331";
const OTHER = "01933333-3333-7333-8333-333333333332";
const subscriptions = new PushSubscriptions(mongo, true);

beforeEach(clearDatabase);

describe("subscribe", () => {
  test("is refused without a push adapter", async () => {
    const error = await refusal(
      new PushSubscriptions(mongo, false).subscribe(ME, fakeSubscription(1)),
    );
    expect(error.extensions["code"]).toBe(
      "notifications.errors.push-unavailable",
    );
  });

  test("refuses an endpoint that is no push service's", async () => {
    const issues = await issuesOf(
      subscriptions.subscribe(ME, {
        ...fakeSubscription(1),
        endpoint: "https://127.0.0.1/send",
      }),
    );
    expect(issues).toMatchObject([
      { path: "endpoint", code: "validation.errors.invalid-format" },
    ]);
  });

  test("subscribing twice keeps one; an endpoint moves to the last account to use it", async () => {
    await subscriptions.subscribe(ME, fakeSubscription(1));
    await subscriptions.subscribe(ME, fakeSubscription(1));
    expect(await subscriptions.of(ME)).toHaveLength(1);
    await subscriptions.subscribe(OTHER, fakeSubscription(1));
    expect(await subscriptions.of(ME)).toEqual([]);
    expect(await subscriptions.of(OTHER)).toHaveLength(1);
  });

  test("keeps ten browsers, the oldest going first", async () => {
    for (let n = 1; n <= 12; n += 1) {
      await subscriptions.subscribe(ME, fakeSubscription(n));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const kept = (await subscriptions.of(ME)).map((one) => one.endpoint);
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain(fakeSubscription(1).endpoint);
    expect(kept).toContain(fakeSubscription(12).endpoint);
  });
});

describe("unsubscribe", () => {
  test("forgets the account's own subscription only", async () => {
    await subscriptions.subscribe(ME, fakeSubscription(1));
    expect(
      await subscriptions.unsubscribe(OTHER, fakeSubscription(1).endpoint),
    ).toBe(false);
    expect(
      await subscriptions.unsubscribe(ME, fakeSubscription(1).endpoint),
    ).toBe(true);
    expect(
      await subscriptions.unsubscribe(ME, fakeSubscription(1).endpoint),
    ).toBe(false);
  });
});
