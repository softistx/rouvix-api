import type { ReadDocumentOf } from "@softistx/mongo";
import type { NotificationKind, notifications } from "./models";
import {
  type NotificationSettings,
  SETTING_NAMES,
} from "./notifications.rules";
import { footerOf, noticeWords } from "./notifications.texts";

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => escapes[char] as string);

// The fields of an `updateSettings` input that were given (null is absent).
export function givenSettings(
  input: {
    [K in keyof NotificationSettings]?: boolean | null | undefined;
  },
): Partial<NotificationSettings> {
  const given: Partial<NotificationSettings> = {};
  for (const name of SETTING_NAMES) {
    const value = input[name];
    if (value !== null && value !== undefined) given[name] = value;
  }
  return given;
}

// The e-mail copy of a notice: subject, text and html, the link a path of the UI.
export function mailOf(options: {
  kind: NotificationKind;
  language: "fr" | "en";
  preview: string | null;
  uiUrl: string;
  path: string;
}) {
  const { title, body } = noticeWords(
    options.kind,
    options.language,
    options.preview,
  );
  const footer = footerOf(options.language);
  const link = `${options.uiUrl}${options.path}`;
  const settings = `${options.uiUrl}/settings?section=notifications`;
  return {
    subject: `${title} · ${body}`,
    text: `${body}\n\n${link}\n\n${footer.text}\n${footer.settings}: ${settings}`,
    html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p><small>${escapeHtml(footer.text)} <a href="${escapeHtml(settings)}">${escapeHtml(footer.settings)}</a></small></p>`,
  };
}

// A notice as the collection holds it, and the settings as `Viewer.settings`
// and `updateSettings` answer them (the language is janus's).
export type NotificationDocument = ReadDocumentOf<typeof notifications>;
export type SettingsView = NotificationSettings & { locale: "fr" | "en" };
