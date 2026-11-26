import type { MediaBucket } from "@softistx/alxia-media";
import { viewerOf } from "@/auth/access";
import { mongo } from "@/config/db";
import type { Embedder } from "@/embedder";
import { services } from "@/modules";
import { CountriesService } from "@/modules/config";
import {
  IdDocumentsService,
  type ListingContent,
  PhotosService,
} from "@/modules/listings/services";
import { textRanker } from "@/modules/search";
import type { ImageRedactor } from "@/redactor";
import type { AuthApp } from "~/auth";
import { fakeE164, signedIn, uploadPhoto } from "~/fixtures";
import { jpegOf } from "~/images";

// The services of one request as the viewer `n` (a fake Cameroon number), over
// the test kit's ports and in-memory bucket.
export async function listingsAs(
  kit: AuthApp,
  n = 1,
  options: { claudeDailyCap?: number; embedder?: Embedder } = {},
) {
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
    ocr: kit.ocr,
    redactor: kit.redactor,
    vault: kit.vault,
    ranker: textRanker,
    describer: kit.claude.describer,
    embedder: options.embedder ?? kit.ollama.embedder,
    claudeDailyCap: options.claudeDailyCap ?? 50,
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

// A found CNI kept with its finder, drawn photos aside: what a finder declares
// of an ID document. `over` replaces fields.
export const documentContent = (
  over: Partial<ListingContent> = {},
): ListingContent =>
  foundContent({
    categoryKey: "DOCUMENT",
    documentType: "CNI",
    title: "CNI trouvée",
    description: "Trouvée près de la gare",
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

export const noPause = async () => {};

// The ID document pipeline over `bucket` and the kit's OCR, vault and blur (or
// `redactor`), with no pause between its retries.
export const idDocumentsOver = (
  kit: AuthApp,
  bucket: MediaBucket,
  redactor: ImageRedactor = kit.redactor,
) =>
  new IdDocumentsService({
    bucket,
    ocr: kit.ocr,
    redactor,
    vault: kit.vault,
    countries: new CountriesService(mongo),
    now: () => new Date(kit.clock.now()),
    pause: noPause,
  });

// The photo job over `bucket` (a flaky one, say), with no pause.
export const photosOver = (kit: AuthApp, bucket: MediaBucket) =>
  new PhotosService(mongo, bucket, idDocumentsOver(kit, bucket), noPause);
