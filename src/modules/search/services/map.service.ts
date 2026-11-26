import type { AppMongo } from "@/config/db";
import { fromGeoJson } from "@/modules/config";
import type { Now } from "@/shared/dates";
import { invalidInput } from "@/shared/errors";
import {
  type Box,
  boxIssues,
  circleTouches,
  clusterPoints,
  filterIssues,
  type MapPoint,
  widened,
  zoomOf,
} from "../search.rules";
import { MAP_MAX, MAP_SCAN, matchOf, type SearchFilter } from "../search.utils";

// The largest loss area, in metres: circles are looked for this far past the box.
const MAX_RADIUS_M = 20_000;

const none = { docs: [], truncated: false };

interface MapDoc {
  _id: { toHexString(): string };
  categoryKey: string;
  documentType: string | null;
  geo: { coordinates: [number, number] };
  place?: { radiusM: number | null };
}

// The map (spec §5.4), public. It reads the blurred `geo` of the listings,
// never `place.point`: found items come out as markers or clusters of the
// zoom, lost ones as circles around their blurred centre.
export class MapService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly deps: { now: Now },
  ) {}

  async map(box: Box, filter: SearchFilter, zoom: number | null | undefined) {
    const issues = [...boxIssues(box), ...filterIssues(filter)];
    if (issues.length > 0) throw invalidInput(issues);
    const base = matchOf(filter, this.deps.now());
    const [found, lost] = await Promise.all([
      filter.kind === "LOST" ? none : this.found(base, box),
      filter.kind === "FOUND" ? none : this.lost(base, box),
    ]);
    const grouped = clusterPoints(found.docs.map(pointOf), zoom ?? zoomOf(box));
    return {
      markers: grouped.flatMap((g) =>
        "marker" in g
          ? [
              {
                id: g.marker.id,
                categoryKey: g.marker.categoryKey,
                documentType: g.marker.documentType,
                point: g.marker.point,
              },
            ]
          : [],
      ),
      clusters: grouped.flatMap((g) => ("cluster" in g ? [g.cluster] : [])),
      circles: lost.docs,
      truncated: found.truncated || lost.truncated,
    };
  }

  // The found listings with a point in the box, newest first, up to the scan.
  private async found(base: Record<string, unknown>, box: Box) {
    const docs = await this.mongo.db.listings.raw
      .find(
        { ...base, ...inBox(box), kind: "FOUND" },
        { projection: { categoryKey: 1, documentType: 1, geo: 1 } },
      )
      .sort({ date: -1, _id: -1 })
      .limit(MAP_SCAN + 1)
      .toArray();
    return {
      docs: docs.slice(0, MAP_SCAN) as unknown as MapDoc[],
      truncated: docs.length > MAP_SCAN,
    };
  }

  // The lost listings whose loss area touches the box, newest first, 500 at most.
  private async lost(base: Record<string, unknown>, box: Box) {
    const docs = (await this.mongo.db.listings.raw
      .find(
        { ...base, ...inBox(widened(box, MAX_RADIUS_M)), kind: "LOST" },
        {
          projection: {
            categoryKey: 1,
            documentType: 1,
            geo: 1,
            "place.radiusM": 1,
          },
        },
      )
      .sort({ date: -1, _id: -1 })
      .limit(MAP_SCAN)
      .toArray()) as unknown as MapDoc[];
    const touching = docs.flatMap((doc) => {
      const center = fromGeoJson(doc.geo);
      const radiusM = doc.place?.radiusM ?? 0;
      return circleTouches(box, center, radiusM)
        ? [
            {
              id: doc._id.toHexString(),
              categoryKey: doc.categoryKey,
              documentType: doc.documentType,
              center,
              radiusM,
            },
          ]
        : [];
    });
    return {
      docs: touching.slice(0, MAP_MAX),
      truncated: touching.length > MAP_MAX || docs.length === MAP_SCAN,
    };
  }
}

// The stored `geo` of a listing inside the box, by range on its coordinates.
const inBox = (box: Box) => ({
  "geo.coordinates.0": { $gte: box.west, $lte: box.east },
  "geo.coordinates.1": { $gte: box.south, $lte: box.north },
});

const pointOf = (doc: MapDoc): MapPoint => ({
  id: doc._id.toHexString(),
  categoryKey: doc.categoryKey,
  documentType: doc.documentType,
  point: fromGeoJson(doc.geo),
});
