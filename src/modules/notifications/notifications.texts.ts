import type { NotificationKind } from "./models";

type Language = "fr" | "en";

// The words of a push and of a mail copy, per language of the account. Fixed
// sentences: they name the kind of event and nothing of the item, a phone
// number or an ID. A preview, when the account allowed it, is appended.
const BODIES: Record<Language, Record<NotificationKind, string>> = {
  fr: {
    MATCH: "Un objet pourrait correspondre à une de vos annonces.",
    MESSAGE: "Vous avez un nouveau message.",
    CLAIM: "Une réclamation vous concerne.",
  },
  en: {
    MATCH: "An item may match one of your listings.",
    MESSAGE: "You have a new message.",
    CLAIM: "A claim concerns you.",
  },
};

const FOOTERS: Record<Language, string> = {
  fr: "Vous recevez cette copie car les copies par e-mail sont activées dans vos réglages.",
  en: "You get this copy because e-mail copies are on in your settings.",
};

const SETTINGS_LABEL: Record<Language, string> = {
  fr: "Réglages des notifications",
  en: "Notification settings",
};

export const APP_NAME = "Rouvix";

export function noticeWords(
  kind: NotificationKind,
  language: Language,
  preview: string | null,
) {
  const body = BODIES[language][kind];
  return {
    title: APP_NAME,
    body: preview === null ? body : `${body} « ${preview} »`,
  };
}

export const footerOf = (language: Language) => ({
  text: FOOTERS[language],
  settings: SETTINGS_LABEL[language],
});
