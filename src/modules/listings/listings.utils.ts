import { type GeoPoint, toGeoJson } from "@/modules/config";
import { DAY_MS } from "@/shared/dates";
import type { KeptAt, ListingStatus, PhotoStatus } from "./models";

// A listing lives 90 days, and an extension adds as many, up to three times.
export const LISTING_DAYS = 90;
export const MAX_EXTENSIONS = 3;

// What a visitor reads: an open or a claimed listing.
export const PUBLIC_STATUSES: readonly ListingStatus[] = ["OPEN", "CLAIMED"];

// What an author may still change.
export const EDITABLE_STATUSES: readonly ListingStatus[] = [
  "DRAFT",
  "PENDING",
  "OPEN",
];

// What an author may close.
export const CLOSABLE_STATUSES: readonly ListingStatus[] = [
  "DRAFT",
  "PENDING",
  "OPEN",
  "CLAIMED",
  "EXPIRED",
];

export const addDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * DAY_MS);

// The UTC day of an instant, at midnight.
export const dayOf = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

// The day at UTC midnight a `YYYY-MM-DD` names.
export const dayOfString = (date: string) => new Date(`${date}T00:00:00.000Z`);

// The `YYYY-MM-DD` of a stored day.
export const dateString = (date: Date) => date.toISOString().slice(0, 10);

const round = (value: number, decimals: number) =>
  Number(value.toFixed(decimals));

// A point to about 110 m (three decimals): what the public view shows of a
// place that is private. A lost item is never given as a point, only as this
// rounded centre and its radius; an item kept with its finder is this too.
export const blurredPoint = (point: GeoPoint): GeoPoint => ({
  latitude: round(point.latitude, 3),
  longitude: round(point.longitude, 3),
});

// The point a visitor sees: the exact one where the item is kept in a public
// place (a police station, an organisation), the blurred one everywhere else.
export const publicPoint = (
  point: GeoPoint,
  keptAt: KeptAt | null,
): GeoPoint =>
  keptAt === "AT_POLICE" || keptAt === "AT_ORGANISATION"
    ? point
    : blurredPoint(point);

// What an author states of a listing (stated whole on an update).
export interface ListingContent {
  countryCode: string;
  categoryKey: string;
  documentType?: string | null | undefined;
  title: string;
  description?: string | null | undefined;
  attributes: {
    colours: string[];
    brand?: string | null | undefined;
    marks?: string | null | undefined;
  };
  photoKeys: string[];
  place: {
    label: string;
    point: GeoPoint;
    radiusM?: number | null | undefined;
    keptAt?: KeptAt | null | undefined;
  };
  // `YYYY-MM-DD`, the Date scalar.
  date: string;
  questions: { prompt: string; answer: string }[];
}

// What a listing's content is stored as: the fields of the stored document.
// `known` holds the status of the photos the listing already carries; a new
// key starts pending.
export function storedFields(
  content: ListingContent,
  known: ReadonlyMap<string, PhotoStatus>,
) {
  return {
    countryCode: content.countryCode,
    categoryKey: content.categoryKey,
    documentType: content.documentType ?? null,
    title: content.title,
    description: content.description ?? "",
    attributes: {
      colours: content.attributes.colours,
      brand: content.attributes.brand ?? null,
      marks: content.attributes.marks ?? null,
    },
    photos: content.photoKeys.map((key) => ({
      key,
      status: known.get(key) ?? ("PENDING" as const),
    })),
    place: {
      label: content.place.label,
      point: toGeoJson(content.place.point),
      radiusM: content.place.radiusM ?? null,
      keptAt: content.place.keptAt ?? null,
    },
    date: dayOfString(content.date),
    questions: content.questions,
  };
}
