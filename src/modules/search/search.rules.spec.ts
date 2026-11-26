import { describe, expect, test } from "bun:test";
import {
  boxIssues,
  circleTouches,
  clusterPoints,
  filterIssues,
  type MapPoint,
  widened,
  zoomOf,
} from "./search.rules";

const box = { south: 4, west: 9, north: 4.2, east: 9.2 };
const pt = (n: number, lat: number, lon: number): MapPoint => ({
  id: String(n),
  categoryKey: "KEYS",
  documentType: null,
  point: { latitude: lat, longitude: lon },
});

describe("issues", () => {
  test("the days the right way round, and a box that is not empty", () => {
    expect(
      filterIssues({ dateFrom: "2026-11-02", dateTo: "2026-11-01" }),
    ).toEqual([{ path: "filter.dateTo", code: "validation.errors.invalid" }]);
    expect(
      filterIssues({ dateFrom: "2026-11-01", dateTo: "2026-11-01" }),
    ).toEqual([]);
    expect(filterIssues(null)).toEqual([]);
    expect(boxIssues(box)).toEqual([]);
    expect(boxIssues({ ...box, south: 5 })).toHaveLength(1);
    expect(boxIssues({ ...box, west: 10 })).toHaveLength(1);
  });
});

describe("zoom and circles", () => {
  test("a zoom from the width of the box, between 0 and 22", () => {
    expect(zoomOf({ ...box, west: -180, east: 180 })).toBe(2);
    expect(zoomOf(box)).toBe(12);
    expect(zoomOf({ ...box, east: 9 })).toBe(22);
  });

  test("a circle touches a box it overlaps, centre outside or not", () => {
    expect(circleTouches(box, { latitude: 4.1, longitude: 9.1 }, 200)).toBe(
      true,
    );
    // 0.01 degree (1.1 km) west of the box.
    const outside = { latitude: 4.1, longitude: 8.99 };
    expect(circleTouches(box, outside, 500)).toBe(false);
    expect(circleTouches(box, outside, 1_500)).toBe(true);
  });

  test("a box widened by the largest area holds the centre of any circle touching it", () => {
    const wide = widened(box, 20_000);
    expect(wide.south).toBeLessThan(box.south - 0.17);
    expect(wide.east).toBeGreaterThan(box.east + 0.17);
    expect(wide.north).toBeGreaterThan(box.north);
  });
});

describe("clusterPoints", () => {
  test("points far apart are markers, points close together a cluster at their centre", () => {
    const grouped = clusterPoints(
      [pt(1, 4.1, 9.1), pt(2, 4.1002, 9.1002), pt(3, 4.15, 9.15)],
      12,
    );
    const clusters = grouped.flatMap((g) =>
      "cluster" in g ? [g.cluster] : [],
    );
    const markers = grouped.flatMap((g) => ("marker" in g ? [g.marker] : []));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      count: 2,
      point: { latitude: 4.1001, longitude: 9.1001 },
      bounds: { south: 4.1, north: 4.1002, west: 9.1, east: 9.1002 },
    });
    expect(markers.map((m) => m.id)).toEqual(["3"]);
  });

  test("zoomed in far enough every point is its own marker", () => {
    const grouped = clusterPoints([pt(1, 4.1, 9.1), pt(2, 4.1002, 9.1002)], 22);
    expect(grouped.every((g) => "marker" in g)).toBe(true);
  });

  test("never more than the cap: the cells grow until the result fits", () => {
    const points = Array.from({ length: 900 }, (_, n) =>
      pt(n, 4 + (n % 30) * 0.002, 9 + Math.floor(n / 30) * 0.002),
    );
    const grouped = clusterPoints(points, 22, 500);
    expect(grouped.length).toBeLessThanOrEqual(500);
    const total = grouped.reduce(
      (sum, g) => sum + ("cluster" in g ? g.cluster.count : 1),
      0,
    );
    expect(total).toBe(900);
  });
});
