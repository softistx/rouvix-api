import { DAY_MS } from "@/shared/dates";
import type { GeoPoint } from "../config/config.utils";
import type { KeptAt, ListingStatus } from "./models";

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

// The day at UTC midnight a `YYYY-MM-DD` names.
export const dayOf = (date: Date) =>
  new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

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
