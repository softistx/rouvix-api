import { distanceM, type GeoPoint } from "@/modules/config";
import { cityKeyOf, dayOfString, type ListingKind } from "@/modules/listings";

// A query reaches its first 500 results at most (the cap of the cursor), reads
// 2 000 candidates to put them in order of distance, and the map reads 5 000
// points to cluster; a bigger answer is cut and said so (`truncated`).
export const MAX_DEPTH = 500;
export const NEAR_SCAN = 2_000;
export const MAP_SCAN = 5_000;
export const MAP_MAX = 500;

const EARTH_RADIUS_M = 6_371_008.8;

// What a visitor narrows by (the GraphQL `ListingFilter`, as the resolver gets it).
export interface SearchFilter {
  text?: string | null | undefined;
  kind?: ListingKind | null | undefined;
  categoryKey?: string | null | undefined;
  documentType?: string | null | undefined;
  city?: string | null | undefined;
  dateFrom?: string | null | undefined;
  dateTo?: string | null | undefined;
  near?: { point: GeoPoint; radiusM: number } | null | undefined;
}

// The filter of the stored documents a search matches. Only `OPEN` listings
// not past their date, the words of `searchText` (which holds nothing a
// visitor may not read), the town folded, the days, and the stored `geo`
// (blurred) for "around me": the exact point is never queried. `without` leaves
// out the chip whose own count is being taken.
export function matchOf(
  filter: SearchFilter,
  now: Date,
  without?: "kind" | "categoryKey",
) {
  const match: Record<string, unknown> = {
    status: "OPEN",
    expiresAt: { $gt: now },
  };
  if (filter.text) match["$text"] = { $search: filter.text };
  if (filter.kind && without !== "kind") match["kind"] = filter.kind;
  if (filter.categoryKey && without !== "categoryKey") {
    match["categoryKey"] = filter.categoryKey;
  }
  if (filter.documentType) match["documentType"] = filter.documentType;
  const cityKey = cityKeyOf(filter.city);
  if (cityKey !== null) match["cityKey"] = cityKey;
  if (filter.dateFrom || filter.dateTo) {
    match["date"] = {
      ...(filter.dateFrom && { $gte: dayOfString(filter.dateFrom) }),
      ...(filter.dateTo && { $lte: dayOfString(filter.dateTo) }),
    };
  }
  if (filter.near) {
    const { point, radiusM } = filter.near;
    match["geo"] = {
      $geoWithin: {
        $centerSphere: [
          [point.longitude, point.latitude],
          radiusM / EARTH_RADIUS_M,
        ],
      },
    };
  }
  return match;
}

// The distance of a stored (blurred) point from the `near` of a filter.
export const distanceFrom = (
  near: NonNullable<SearchFilter["near"]>,
  geo: { coordinates: readonly [number, number] },
) =>
  distanceM(near.point, {
    latitude: geo.coordinates[1],
    longitude: geo.coordinates[0],
  });

// An opaque cursor: the offset of the next page.
export const encodeCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ o: offset })).toString("base64url");

// The offset a cursor names, or undefined for one this query never gave.
export function decodeCursor(after: string | null | undefined) {
  if (after === null || after === undefined) return 0;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(after, "base64url").toString(),
    );
    const offset = (parsed as { o?: unknown } | null)?.o;
    return Number.isInteger(offset) &&
      (offset as number) >= 0 &&
      (offset as number) <= MAX_DEPTH
      ? (offset as number)
      : undefined;
  } catch {
    return undefined;
  }
}
