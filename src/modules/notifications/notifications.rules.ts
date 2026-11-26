import type { NotificationKind } from "./models";

// The settings an account holds until it changes them (spec §5.6): every event
// on, no e-mail copies, no preview. A preview puts item detail on a lock screen
// or in a mail, so it is the account's choice, off by default.
export interface NotificationSettings {
  notifyMatch: boolean;
  notifyMessage: boolean;
  notifyClaim: boolean;
  emailCopies: boolean;
  pushPreviews: boolean;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  notifyMatch: true,
  notifyMessage: true,
  notifyClaim: true,
  emailCopies: false,
  pushPreviews: false,
};

// The setting that says whether an event reaches the account's push and mail.
export const KIND_SETTING = {
  MATCH: "notifyMatch",
  MESSAGE: "notifyMessage",
  CLAIM: "notifyClaim",
} as const satisfies Record<NotificationKind, keyof NotificationSettings>;

export const SETTING_NAMES = [
  "notifyMatch",
  "notifyMessage",
  "notifyClaim",
  "emailCopies",
  "pushPreviews",
] as const satisfies readonly (keyof NotificationSettings)[];

export const settingsOf = (
  stored: Partial<NotificationSettings> | undefined,
): NotificationSettings => ({
  notifyMatch: stored?.notifyMatch ?? DEFAULT_SETTINGS.notifyMatch,
  notifyMessage: stored?.notifyMessage ?? DEFAULT_SETTINGS.notifyMessage,
  notifyClaim: stored?.notifyClaim ?? DEFAULT_SETTINGS.notifyClaim,
  emailCopies: stored?.emailCopies ?? DEFAULT_SETTINGS.emailCopies,
  pushPreviews: stored?.pushPreviews ?? DEFAULT_SETTINGS.pushPreviews,
});

// A browser may be subscribed on this many devices; the oldest goes first.
export const MAX_PUSH_SUBSCRIPTIONS = 10;

// A push endpoint is a URL this server will POST to, so it is one a push
// service can be: https on the default port, no credentials, a named host with
// a dot (never an address or `localhost`), so a subscription cannot aim the
// server at the private network. A private name that resolves inside is not
// told apart here: the adapter must connect to public addresses only.
export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname;
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    host.includes(".") &&
    !host.endsWith(".") &&
    !host.startsWith("[") &&
    !/^[\d.]+$/.test(host) &&
    !/\.(local|internal|localhost|test)$/.test(host)
  );
}

// The part of a listing a preview may be made of.
export interface PreviewSource {
  title: string;
  status: string;
  authorId: string;
  documentType: string | null;
  photos: readonly { blurredKey: string | null }[];
}

const PREVIEW_LENGTH = 60;
const PUBLIC = ["OPEN", "CLAIMED"];

// The item detail a push or a mail may carry when the account turned previews
// on: an object's own title, and nothing else. Never an ID document's (its
// title is the author's free text), never an object the local OCR found ID-like
// (it has a blurred copy), never a title holding a run of six digits or more
// (a number written in it, spaces and dashes or not), never a listing the
// account may not see. Null: no preview, the generic words.
export function previewOf(
  listing: PreviewSource,
  accountId: string,
): string | null {
  if (listing.documentType !== null) return null;
  if (listing.photos.some((photo) => photo.blurredKey !== null)) return null;
  if (!PUBLIC.includes(listing.status) && listing.authorId !== accountId) {
    return null;
  }
  const title = listing.title.replace(/\s+/g, " ").trim();
  const digits = title.replace(/(?<=\d)[\s.\-/()](?=\d)/g, "");
  if (/\d{6,}/.test(digits)) return null;
  return title.length > PREVIEW_LENGTH
    ? `${title.slice(0, PREVIEW_LENGTH - 1)}…`
    : title;
}

// Where a click on a push or a link in a mail lands: the listing's page when
// there is a preview (the account chose to see detail), else the page of the
// event's kind, which names no item.
export function pathOf(
  kind: NotificationKind,
  preview: { listingId: string } | null,
): string {
  if (preview !== null)
    return `/items/${encodeURIComponent(preview.listingId)}`;
  return kind === "MESSAGE" ? "/messages" : "/me";
}
