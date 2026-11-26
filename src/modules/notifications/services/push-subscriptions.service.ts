import type { AppMongo } from "@/config/db";
import type { PushTarget } from "@/push";
import { invalidInput } from "@/shared/errors";
import { pushUnavailable } from "../notifications.errors";
import { isPushEndpoint, MAX_PUSH_SUBSCRIPTIONS } from "../notifications.rules";

// The browsers an account subscribed to Web Push. The endpoint and the keys
// are secrets of the device: nothing here returns them but to the sender.
export class PushSubscriptions {
  constructor(
    private readonly mongo: AppMongo,
    private readonly available: boolean,
  ) {}

  // Saves a browser's subscription for `accountId`. An endpoint belongs to one
  // account: a browser handed to another account moves to it. The oldest
  // beyond ten are dropped.
  async subscribe(accountId: string, target: PushTarget) {
    if (!this.available) throw pushUnavailable();
    if (!isPushEndpoint(target.endpoint)) {
      throw invalidInput([
        { path: "endpoint", code: "validation.errors.invalid-format" },
      ]);
    }
    const now = new Date();
    await this.mongo.db.pushSubscriptions.raw.updateOne(
      { endpoint: target.endpoint },
      {
        $set: {
          accountId,
          p256dh: target.p256dh,
          auth: target.auth,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    const stale = await this.mongo.db.pushSubscriptions.raw
      .find({ accountId }, { projection: { _id: 1 } })
      .sort({ createdAt: -1 })
      .skip(MAX_PUSH_SUBSCRIPTIONS)
      .toArray();
    if (stale.length > 0) {
      await this.mongo.db.pushSubscriptions.raw.deleteMany({
        _id: { $in: stale.map((row) => row._id) },
      });
    }
    return true;
  }

  // Forgets the account's subscription for `endpoint`: true when there was one.
  async unsubscribe(accountId: string, endpoint: string) {
    const removed = await this.mongo.db.pushSubscriptions.raw.deleteOne({
      accountId,
      endpoint,
    });
    return removed.deletedCount > 0;
  }

  async of(accountId: string): Promise<PushTarget[]> {
    const rows = await this.mongo.db.pushSubscriptions.raw
      .find({ accountId })
      .toArray();
    return rows.map(({ endpoint, p256dh, auth }) => ({
      endpoint,
      p256dh,
      auth,
    }));
  }

  // Drops the subscriptions a push service said are gone.
  async drop(endpoints: readonly string[]) {
    if (endpoints.length === 0) return;
    await this.mongo.db.pushSubscriptions.raw.deleteMany({
      endpoint: { $in: [...endpoints] },
    });
  }
}
