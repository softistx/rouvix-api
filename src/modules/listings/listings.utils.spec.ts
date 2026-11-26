import { describe, expect, test } from "bun:test";
import {
  addDays,
  blurredKeysOf,
  blurredObjectKey,
  blurredPoint,
  cityKeyOf,
  dateString,
  dayOf,
  dayOfString,
  droppedKeysOf,
  objectKeysOf,
  publicPoint,
  sameItems,
  searchPoint,
  searchTextOf,
} from "./listings.utils";

describe("dates", () => {
  test("a day is at UTC midnight and round-trips as YYYY-MM-DD", () => {
    expect(dayOfString("2026-11-27").toISOString()).toBe(
      "2026-11-27T00:00:00.000Z",
    );
    expect(dateString(dayOfString("2026-11-27"))).toBe("2026-11-27");
    expect(dayOf(new Date(2026, 10, 27, 15, 30)).getUTCHours()).toBe(0);
  });

  test("the day of an instant is its UTC day, whatever the server's zone", () => {
    expect(dayOf(new Date("2026-11-27T23:59:59.000Z")).toISOString()).toBe(
      "2026-11-27T00:00:00.000Z",
    );
    expect(dayOf(new Date("2026-11-28T00:00:01.000Z")).toISOString()).toBe(
      "2026-11-28T00:00:00.000Z",
    );
  });

  test("addDays adds whole days", () => {
    expect(
      addDays(dayOfString("2026-11-27"), 90).toISOString().slice(0, 10),
    ).toBe("2027-02-25");
  });
});

describe("what a visitor sees of a point", () => {
  const exact = { latitude: 4.05123, longitude: 9.70456 };

  test("blurs to three decimals, about 110 m, never the exact digits", () => {
    expect(blurredPoint(exact)).toEqual({ latitude: 4.051, longitude: 9.705 });
  });

  test("an item kept with its finder, or of a lost one, is blurred", () => {
    expect(publicPoint(exact, "WITH_FINDER")).toEqual({
      latitude: 4.051,
      longitude: 9.705,
    });
    expect(publicPoint(exact, null)).toEqual({
      latitude: 4.051,
      longitude: 9.705,
    });
  });

  test("an item kept in a public place is shown where it is", () => {
    expect(publicPoint(exact, "AT_POLICE")).toEqual(exact);
    expect(publicPoint(exact, "AT_ORGANISATION")).toEqual(exact);
  });
});

describe("what search reads of a listing", () => {
  const exact = { latitude: 4.05123, longitude: 9.70456 };

  test("a private point is snapped to a 0.002 degree cell of the blurred one", () => {
    expect(searchPoint(exact, "WITH_FINDER")).toEqual({
      latitude: 4.052,
      longitude: 9.706,
    });
    expect(searchPoint(exact, null)).toEqual({
      latitude: 4.052,
      longitude: 9.706,
    });
    // Whatever the digits past the blurred ones, the cell is the same.
    expect(
      searchPoint({ latitude: 4.05149, longitude: 9.70501 }, null),
    ).toEqual(searchPoint({ latitude: 4.05051, longitude: 9.70549 }, null));
  });

  test("a public place is exact", () => {
    expect(searchPoint(exact, "AT_POLICE")).toEqual(exact);
    expect(searchPoint(exact, "AT_ORGANISATION")).toEqual(exact);
  });

  test("a town folds its case, accents and spaces; none gives none", () => {
    expect(cityKeyOf("  Yaoundé ")).toBe("yaounde");
    expect(cityKeyOf("YAOUNDE")).toBe("yaounde");
    expect(cityKeyOf("Bafoussam  Ouest")).toBe("bafoussam ouest");
    expect(cityKeyOf("   ")).toBeNull();
    expect(cityKeyOf(null)).toBeNull();
  });

  test("the words are the public text; an ID document has only its type", () => {
    const content = {
      title: "Sac",
      description: "Rouge",
      attributes: {
        colours: ["rouge", "noir"],
        brand: "Marque",
        marks: "tache",
      },
    };
    expect(searchTextOf(content)).toBe("Sac Rouge Marque tache rouge noir");
    expect(searchTextOf({ ...content, documentType: "CNI" })).toBe("CNI");
    expect(
      searchTextOf({
        ...content,
        description: "",
        attributes: { colours: [] },
      }),
    ).toBe("Sac");
  });
});

const K1 = "00000000-0000-4000-8000-000000000001";
const K2 = "00000000-0000-4000-8000-000000000002";
const B1 = "00000000-0000-4000-8000-0000000000b1";

describe("the photo helpers", () => {
  test("blurredKeysOf keeps the blurred copies only", () => {
    expect(
      blurredKeysOf([{ blurredKey: null }, { blurredKey: B1 }, {}]),
    ).toEqual([B1]);
  });

  test("objectKeysOf names each rendition and each blurred copy", () => {
    expect(
      objectKeysOf([
        { key: K1, blurredKey: B1 },
        { key: K2, blurredKey: null },
      ]),
    ).toEqual([
      `listing-photos/${K1}/full`,
      `listing-photos/${K2}/full`,
      `listing-blurred/${B1}`,
    ]);
  });

  test("sameItems compares photo by photo", () => {
    const a = { key: K1, status: "READY" as const, blurredKey: null };
    expect(sameItems([a], [{ ...a }])).toBe(true);
    expect(sameItems([a], [{ ...a, blurredKey: B1 }])).toBe(false);
    expect(sameItems([a], [])).toBe(false);
  });

  test("droppedKeysOf names the renditions of the dropped photos, blurredObjectKey a copy", () => {
    const checks = new Map([
      [K1, { outcome: "DROPPED" as const }],
      [K2, { outcome: "READY" as const }],
    ]);
    expect(droppedKeysOf(checks)).toEqual([`listing-photos/${K1}/full`]);
    expect(blurredObjectKey(B1)).toBe(`listing-blurred/${B1}`);
  });
});
