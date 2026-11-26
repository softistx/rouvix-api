import { viewerOf } from "@/auth/access";
import { mongo } from "@/config/db";
import { services } from "@/modules";
import type { ListingContent } from "@/modules/listings/services";
import { textRanker } from "@/modules/search";
import type { AuthApp } from "~/auth";
import { fakeE164, signedIn, uploadPhoto } from "~/fixtures";
import { jpegOf } from "~/images";

// The services of one request as the viewer `n` (a fake Cameroon number), over
// the test kit's ports and in-memory bucket.
export async function listingsAs(kit: AuthApp, n = 1) {
  const person = await signedIn(kit, { phone: fakeE164(n) });
  const viewer = viewerOf(person.account);
  const all = services({
    mongo,
    auth: kit.auth,
    now: () => new Date(kit.clock.now()),
    sms: kit.sms,
    mailer: kit.mailer,
    geocoder: kit.geocoder,
    media: kit.storage.bucket,
    ranker: textRanker,
    background: kit.auth.background,
    viewer,
  });
  return { ...person, viewer, services: all, listings: all.listings };
}

// A drawn photo uploaded through the media route as `token`: its key.
export async function photoOf(kit: AuthApp, token: string) {
  const { key, status } = await uploadPhoto(
    kit,
    token,
    await jpegOf(1800, 1200),
  );
  if (status !== 200) throw new Error(`upload refused: ${status}`);
  return key;
}

const today = () => new Date().toISOString().slice(0, 10);

// A lost phone's content, the Cameroon fixtures; `over` replaces fields.
export const lostContent = (
  over: Partial<ListingContent> = {},
): ListingContent => ({
  countryCode: "CM",
  categoryKey: "PHONE",
  title: "Téléphone noir perdu",
  description: "Perdu près du marché",
  attributes: { colours: ["noir"], brand: "Marque d'essai", marks: null },
  photoKeys: [],
  place: {
    label: "Marché de test, Douala",
    point: { latitude: 4.05123, longitude: 9.70456 },
    radiusM: 500,
  },
  date: today(),
  questions: [],
  ...over,
});

// A found wallet kept with its finder: one question, its answer expected.
export const foundContent = (
  over: Partial<ListingContent> = {},
): ListingContent => ({
  countryCode: "CM",
  categoryKey: "WALLET_BAG",
  title: "Portefeuille brun trouvé",
  description: "Trouvé sur un banc",
  attributes: { colours: ["brun"], brand: null, marks: "une initiale" },
  photoKeys: [],
  place: {
    label: "Jardin de test, Yaoundé",
    point: { latitude: 3.84812, longitude: 11.50234 },
    keptAt: "WITH_FINDER",
  },
  date: today(),
  questions: [{ prompt: "Quelle initiale est brodée ?", answer: "Z" }],
  ...over,
});
