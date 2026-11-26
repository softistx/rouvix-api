import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor, matchOf } from "./search.utils";

const now = new Date("2026-11-27T10:00:00.000Z");

describe("matchOf", () => {
  test("always the open listings not past their expiry", () => {
    expect(matchOf({}, now)).toEqual({
      status: "OPEN",
      expiresAt: { $gt: now },
    });
  });

  test("each filter is one clause on the derived fields", () => {
    const match = matchOf(
      {
        text: "sac",
        kind: "LOST",
        categoryKey: "PHONE",
        documentType: "CNI",
        city: " Yaoundé ",
        dateFrom: "2026-11-01",
        dateTo: "2026-11-20",
        near: { point: { latitude: 4, longitude: 9 }, radiusM: 6_371_008.8 },
      },
      now,
    );
    expect(match).toMatchObject({
      $text: { $search: "sac" },
      kind: "LOST",
      categoryKey: "PHONE",
      documentType: "CNI",
      cityKey: "yaounde",
      date: {
        $gte: new Date("2026-11-01T00:00:00.000Z"),
        $lte: new Date("2026-11-20T00:00:00.000Z"),
      },
      // The blurred `geo`, never `place.point`; a radius of one earth radius is 1 rad.
      geo: { $geoWithin: { $centerSphere: [[9, 4], 1] } },
    });
    expect(JSON.stringify(match)).not.toContain("place.point");
  });

  test("a chip's own field is left out of its count", () => {
    const filter = { kind: "FOUND", categoryKey: "KEYS" } as const;
    expect(matchOf(filter, now, "kind")).not.toHaveProperty("kind");
    expect(matchOf(filter, now, "kind")).toHaveProperty("categoryKey", "KEYS");
    expect(matchOf(filter, now, "categoryKey")).not.toHaveProperty(
      "categoryKey",
    );
  });
});

describe("cursors", () => {
  test("round-trip an offset; the first page is 0", () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
  });

  test("anything else is not a cursor", () => {
    for (const bad of [
      "",
      "***",
      Buffer.from("[]").toString("base64url"),
      Buffer.from('{"o":1.5}').toString("base64url"),
      Buffer.from('{"o":-3}').toString("base64url"),
      Buffer.from('{"o":"4"}').toString("base64url"),
    ]) {
      expect(decodeCursor(bad)).toBeUndefined();
    }
  });
});
