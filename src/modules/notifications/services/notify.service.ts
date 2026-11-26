import type { Mailer } from "@softistx/mail";
import { ObjectId } from "mongodb";
import type { Auth } from "@/auth/auth";
import type { PushSender } from "@/push";
import type { Background } from "@/shared/background";
import type { NotificationKind } from "../models";
import {
  KIND_SETTING,
  type NotificationSettings,
  type PreviewSource,
  pathOf,
  previewOf,
} from "../notifications.rules";
import { noticeWords } from "../notifications.texts";
import { mailOf } from "../notifications.utils";
import type { NoticesService } from "./notices.service";
import type { PushSubscriptions } from "./push-subscriptions.service";
import type { SettingsService } from "./settings.service";

// What the later slices announce (matching, chat, claims): the kind, and the
// listing it is about. Nothing else: the notice, the push and the mail are made
// here from the kind, so no caller can put a phone number, an ID or a title in
// one.
export interface NotifyEvent {
  kind: NotificationKind;
  listingId?: string | null | undefined;
}

export interface NotifyDeps {
  auth: Pick<Auth, "accounts">;
  notices: NoticesService;
  settings: SettingsService;
  subscriptions: PushSubscriptions;
  push: PushSender;
  mailer: Mailer;
  background: Pick<Background, "run">;
  // The listing a preview is made from, or undefined for an unknown id.
  listing: (id: ObjectId) => Promise<PreviewSource | undefined>;
  mail: { from: string; uiUrl: string };
}

// `notify(accountId, event)` (spec §5.6): the one door the later slices call.
// The in-app notice is always recorded, whatever the settings (it is the
// account's own record of what happened). The push and the e-mail copy go
// only when the account turned that event on, and in the background: nothing
// waits for a push service or an SMTP server. A push carries no item detail
// unless previews are on; the mail goes to a verified address only. A
// suspended account gets the notice and nothing else. Never throws for an
// unknown account (it was deleted): there is nobody to tell.
export class NotifyService {
  constructor(private readonly deps: NotifyDeps) {}

  async notify(accountId: string, event: NotifyEvent) {
    const { auth, notices, settings } = this.deps;
    const account = await auth.accounts.find(accountId);
    if (account === null) return null;
    const listingId =
      event.listingId == null ? null : new ObjectId(event.listingId);
    const notice = await notices.create(accountId, event.kind, listingId);
    const mine = await settings.of(accountId);
    if (!mine[KIND_SETTING[event.kind]] || account.suspendedAt !== null) {
      return notice;
    }
    const preview = await this.previewFor(mine, accountId, listingId);
    const words = noticeWords(
      event.kind,
      account.locale,
      preview?.title ?? null,
    );
    const path = pathOf(
      event.kind,
      preview && { listingId: preview.listingId },
    );
    this.deps.background.run("push", () =>
      this.pushTo(accountId, { ...words, url: path }),
    );
    if (mine.emailCopies && account.email && account.emailVerifiedAt) {
      const to = account.email;
      const mail = mailOf({
        kind: event.kind,
        language: account.locale,
        preview: preview?.title ?? null,
        uiUrl: this.deps.mail.uiUrl,
        path,
      });
      this.deps.background.run("notice mail", () =>
        this.deps.mailer.send({
          from: this.deps.mail.from,
          to,
          ...mail,
          idempotencyKey: `notice-${notice._id.toHexString()}`,
        }),
      );
    }
    return notice;
  }

  private async previewFor(
    mine: NotificationSettings,
    accountId: string,
    listingId: ObjectId | null,
  ) {
    if (!mine.pushPreviews || listingId === null) return null;
    const listing = await this.deps.listing(listingId);
    const title = listing && previewOf(listing, accountId);
    return title ? { title, listingId: listingId.toHexString() } : null;
  }

  // One push per subscription; one that fails never stops the others. The
  // ones the push service says are gone are forgotten.
  private async pushTo(
    accountId: string,
    payload: { title: string; body: string; url: string },
  ) {
    const { push, subscriptions } = this.deps;
    if (!push.available) return;
    const gone: string[] = [];
    const failures: unknown[] = [];
    for (const target of await subscriptions.of(accountId)) {
      try {
        if ((await push.send(target, payload)) === "gone") {
          gone.push(target.endpoint);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    await subscriptions.drop(gone);
    if (failures.length > 0) {
      throw new Error(`${failures.length} push(es) failed`, {
        cause: failures[0],
      });
    }
  }
}
