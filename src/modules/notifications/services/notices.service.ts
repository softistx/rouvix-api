import { isObjectIdString } from "@softistx/mongo";
import { ObjectId } from "mongodb";
import type { AppMongo } from "@/config/db";
import type { Now } from "@/shared/dates";
import { failOnFields, idsIssue } from "@/shared/errors";
import { toConnection } from "@/shared/pagination";
import type { NotificationKind } from "../models";

// The in-app notices of one account: its own, newest first.
export class NoticesService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly now: Now,
  ) {}

  create(
    accountId: string,
    kind: NotificationKind,
    listingId: ObjectId | null,
  ) {
    return this.mongo.db.notifications.create({
      accountId,
      kind,
      listingId,
      readAt: null,
    });
  }

  async list(
    accountId: string,
    page: { first: number; after: string | null | undefined },
  ) {
    const [items, total, unread] = await Promise.all([
      this.mongo.db.notifications.paginateByCursor({
        filter: { accountId },
        limit: page.first,
        after: page.after ?? null,
        orderBy: "createdAt",
        direction: "desc",
      }),
      this.mongo.db.notifications.count({ accountId }),
      this.mongo.db.notifications.count({ accountId, readAt: null }),
    ]);
    return { ...toConnection(page.after, items, total), unreadCount: unread };
  }

  // Marks the account's notices read, all or none: an id that is no notice of
  // its own (unknown, malformed, another account's) refuses the whole call, each
  // such id listed. Already read ones keep their first date.
  async markRead(accountId: string, ids: readonly string[]) {
    const now = this.now();
    const distinct = [...new Set(ids)];
    const valid = distinct.filter(isObjectIdString);
    const owned = await this.mongo.db.notifications.findMany({
      filter: { accountId, _id: { $in: valid.map((id) => new ObjectId(id)) } },
    });
    const found = new Set(owned.map((notice) => notice._id.toHexString()));
    const missing = ids.flatMap((id, i) =>
      found.has(id)
        ? []
        : [idsIssue(i, "notifications.errors.notification-not-found")],
    );
    if (missing.length > 0) {
      throw failOnFields(
        "notifications.errors.notification-not-found",
        missing,
        {
          status: 404,
        },
      );
    }
    await this.mongo.db.notifications.raw.updateMany(
      {
        accountId,
        _id: { $in: owned.map((notice) => notice._id) },
        readAt: null,
      },
      { $set: { readAt: now, updatedAt: now } },
    );
    return this.mongo.db.notifications.findMany({
      filter: { accountId, _id: { $in: owned.map((notice) => notice._id) } },
    });
  }
}
