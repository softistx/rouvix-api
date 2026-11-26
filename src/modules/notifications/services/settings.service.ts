import type { Viewer } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import type { AppMongo } from "@/config/db";
import { type NotificationSettings, settingsOf } from "../notifications.rules";
import { givenSettings } from "../notifications.utils";

// The account's notification settings (spec §5.6) and its language, which
// janus holds. An account that never saved holds the defaults.
export class SettingsService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly auth: Pick<Auth, "accounts">,
  ) {}

  // The stored settings of `accountId`, the defaults filling what it never set.
  async of(accountId: string): Promise<NotificationSettings> {
    return settingsOf(await this.mongo.db.accountSettings.findById(accountId));
  }

  // What `Viewer.settings` returns: the language is the account's own.
  async viewOf(viewer: Viewer) {
    return { ...(await this.of(viewer.id)), locale: viewer.locale };
  }

  // Saves the fields given (the others stay), and the language when given.
  async update(
    viewer: Viewer,
    input: Parameters<typeof givenSettings>[0] & {
      locale?: "fr" | "en" | null | undefined;
    },
  ) {
    const given = givenSettings(input);
    const current = await this.of(viewer.id);
    if (Object.keys(given).length > 0) {
      await this.mongo.db.accountSettings.raw.updateOne(
        { _id: viewer.id },
        {
          $set: { ...current, ...given, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }
    const locale = input.locale ?? viewer.locale;
    if (locale !== viewer.locale) {
      await this.auth.accounts.update(viewer.id, { locale });
    }
    return { ...current, ...given, locale };
  }
}
