import { mediaObjectKey } from "@softistx/alxia-media";
import { type GeoPoint, toGeoJson } from "@/modules/config";
import { DAY_MS } from "@/shared/dates";
import { BLURRED_KIND, PHOTO_FULL, PHOTO_KIND } from "./listings.media";
import type { KeptAt, ListingPhoto, ListingStatus } from "./models";

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

// The grid a private point is snapped to for search and the map: 0.002 degrees,
// about 220 m. It snaps the point the public view already shows (three
// decimals), so the map and the filters give away nothing the view does not.
const GRID_DEG = 0.002;
const snap = (value: number) =>
  round(Math.round(value / GRID_DEG) * GRID_DEG, 3);

// The point a visitor may filter and map by: where the item is kept when that
// is a public place, else the blurred point snapped to about 220 m. Never the
// exact point of a private place, a lost item's included.
export const searchPoint = (
  point: GeoPoint,
  keptAt: KeptAt | null,
): GeoPoint => {
  const shown = publicPoint(point, keptAt);
  return keptAt === "AT_POLICE" || keptAt === "AT_ORGANISATION"
    ? shown
    : { latitude: snap(shown.latitude), longitude: snap(shown.longitude) };
};

// A town folded to compare: no accent, no case, single spaces. null for none.
export const cityKeyOf = (city: string | null | undefined): string | null => {
  const key = (city ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return key === "" ? null : key;
};

// The words a visitor's text matches. An ID document has no free text in
// public (the masked view returns none), so none is searchable: only its type.
export const searchTextOf = (content: {
  documentType?: string | null | undefined;
  title: string;
  description?: string | null | undefined;
  attributes: {
    colours: readonly string[];
    brand?: string | null | undefined;
    marks?: string | null | undefined;
  };
}): string =>
  content.documentType
    ? content.documentType
    : [
        content.title,
        content.description,
        content.attributes.brand,
        content.attributes.marks,
        ...content.attributes.colours,
      ]
        .filter((part): part is string => !!part)
        .join(" ");

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
    city?: string | null | undefined;
  };
  // `YYYY-MM-DD`, the Date scalar.
  date: string;
  questions: { prompt: string; answer: string }[];
}

// What a listing's content is stored as: the fields of the stored document.
// `known` holds the photos the listing already carries, as they were
// processed; a new key starts pending, with no blurred copy.
export function storedFields(
  content: ListingContent,
  known: ReadonlyMap<string, ListingPhoto>,
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
    photos: content.photoKeys.map(
      (key): ListingPhoto =>
        known.get(key) ?? { key, status: "PENDING", blurredKey: null },
    ),
    place: {
      label: content.place.label,
      point: toGeoJson(content.place.point),
      radiusM: content.place.radiusM ?? null,
      keptAt: content.place.keptAt ?? null,
      city: content.place.city?.trim() || null,
    },
    searchText: searchTextOf(content),
    // An ID document's town could be its holder's: never searchable.
    cityKey: content.documentType ? null : cityKeyOf(content.place.city),
    geo: toGeoJson(
      searchPoint(content.place.point, content.place.keptAt ?? null),
    ),
    date: dayOfString(content.date),
    questions: content.questions,
  };
}

// The blurred copies among photos, or among what the photo job made of them.
export const blurredKeysOf = (
  items: Iterable<{ blurredKey?: string | null | undefined }>,
): string[] =>
  [...items].flatMap((item) =>
    typeof item.blurredKey === "string" ? [item.blurredKey] : [],
  );

// The bucket objects of photos: each one's rendition and its blurred copy.
export const objectKeysOf = (
  photos: readonly Pick<ListingPhoto, "key" | "blurredKey">[],
): string[] => [
  ...photos.map((photo) => mediaObjectKey(PHOTO_KIND, photo.key, PHOTO_FULL)),
  ...blurredKeysOf(photos).map((key) => mediaObjectKey(BLURRED_KIND, key)),
];

// Whether two lists of photos say the same, photo by photo.
export const sameItems = (
  a: readonly ListingPhoto[],
  b: readonly ListingPhoto[],
) =>
  a.length === b.length &&
  a.every(
    (photo, i) =>
      photo.key === b[i]?.key &&
      photo.status === b[i]?.status &&
      photo.blurredKey === b[i]?.blurredKey,
  );
