import { distanceM, type GeoPoint } from "@/modules/config";
import type { FieldIssue } from "@/shared/errors";
import { MAP_MAX, type SearchFilter } from "./search.utils";

export interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

// The issues of a filter, each on its path under `filter`: the days the right
// way round.
export function filterIssues(filter: SearchFilter | null | undefined) {
  const issues: FieldIssue[] = [];
  if (filter?.dateFrom && filter.dateTo && filter.dateTo < filter.dateFrom) {
    issues.push({ path: "filter.dateTo", code: "validation.errors.invalid" });
  }
  return issues;
}

// An empty box: south above north, or west east of east (a box across the
// antimeridian is not asked for in Cameroon's zone).
export function boxIssues(box: Box): FieldIssue[] {
  return box.south > box.north || box.west > box.east
    ? [{ path: "bbox", code: "validation.errors.invalid" }]
    : [];
}

// A zoom for a box asked without one: a map about 1 000 px wide.
export const zoomOf = (box: Box) =>
  Math.min(
    22,
    Math.max(
      0,
      Math.floor(Math.log2(1440 / Math.max(box.east - box.west, 1e-6))),
    ),
  );

// Whether a circle of `radiusM` around `center` touches the box.
export function circleTouches(box: Box, center: GeoPoint, radiusM: number) {
  const nearest = {
    latitude: Math.min(Math.max(center.latitude, box.south), box.north),
    longitude: Math.min(Math.max(center.longitude, box.west), box.east),
  };
  return distanceM(center, nearest) <= radiusM;
}

// The box widened by the largest loss area (20 km), to find the circles whose
// centre is outside it.
export function widened(box: Box, radiusM: number): Box {
  const lat = radiusM / 111_320;
  const edge = Math.min(85, Math.max(Math.abs(box.south), Math.abs(box.north)));
  const lon = lat / Math.max(0.05, Math.cos((edge * Math.PI) / 180));
  return {
    south: box.south - lat,
    north: box.north + lat,
    west: box.west - lon,
    east: box.east + lon,
  };
}

export interface MapPoint {
  id: string;
  categoryKey: string;
  documentType: string | null;
  point: GeoPoint;
}

export type Grouped =
  | { marker: MapPoint }
  | { cluster: { point: GeoPoint; count: number; bounds: Box } };

// The points of one zoom, grouped on a grid of 64 px cells: a cell with one
// point is a marker, a cell with several a cluster at their centre. When the
// result is over `max`, the cells double until it is not.
export function clusterPoints(
  points: readonly MapPoint[],
  zoom: number,
  max = MAP_MAX,
): Grouped[] {
  let cell = (360 / 2 ** zoom) * (64 / 256);
  for (let pass = 0; pass < 24; pass++, cell *= 2) {
    const cells = new Map<string, MapPoint[]>();
    for (const p of points) {
      const key = `${Math.floor(p.point.longitude / cell)}:${Math.floor(p.point.latitude / cell)}`;
      const members = cells.get(key);
      if (members) members.push(p);
      else cells.set(key, [p]);
    }
    if (cells.size <= max || pass === 23) {
      return [...cells.values()].map(grouped);
    }
  }
  return [];
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

function grouped(members: MapPoint[]): Grouped {
  const [first] = members;
  if (members.length === 1 && first !== undefined) return { marker: first };
  const lats = members.map((m) => m.point.latitude);
  const lons = members.map((m) => m.point.longitude);
  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    cluster: {
      point: { latitude: round5(mean(lats)), longitude: round5(mean(lons)) },
      count: members.length,
      bounds: {
        south: Math.min(...lats),
        north: Math.max(...lats),
        west: Math.min(...lons),
        east: Math.max(...lons),
      },
    },
  };
}
