import { describe, expect, test } from "bun:test";
import {
  catalogueOf,
  errorParams,
  messageIn,
  messagesOf,
  stableJson,
  versionOf,
} from "./translations.utils";

const rows = [
  { _id: "a.errors.x", texts: { fr: "x fr", en: "x en" } },
  { _id: "a.errors.y", texts: { fr: "y fr" } },
];

describe("catalogueOf", () => {
  test("nests the keys, per language, leaving out a key a language lacks", () => {
    expect(catalogueOf(rows, "fr")).toEqual({
      a: { errors: { x: "x fr", y: "y fr" } },
    });
    expect(catalogueOf(rows, "en")).toEqual({ a: { errors: { x: "x en" } } });
  });

  test("refuses a key that is both a message and a branch, and a prototype key", () => {
    expect(() =>
      catalogueOf(
        [
          { _id: "a.b", texts: { fr: "m" } },
          { _id: "a.b.c", texts: { fr: "m" } },
        ],
        "fr",
      ),
    ).toThrow("both a message and a branch");
    expect(() =>
      catalogueOf([{ _id: "a.__proto__.c", texts: { fr: "m" } }], "fr"),
    ).toThrow();
  });
});

describe("messagesOf", () => {
  test("takes each code from the first catalogue of the chain that has it", () => {
    const chain = [catalogueOf(rows, "en"), catalogueOf(rows, "fr")];
    expect(
      messagesOf(chain, ["a.errors.x", "a.errors.y", "a.errors.none"]),
    ).toEqual([
      { code: "a.errors.x", message: "x en" },
      { code: "a.errors.y", message: "y fr" },
    ]);
    expect(messageIn(chain[0] ?? {}, "a.errors")).toBeUndefined();
  });
});

describe("versionOf", () => {
  test("is the same for the same texts in any key order, and changes with a text", () => {
    expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1}',
    );
    const one = versionOf([{ a: "1", b: "2" }]);
    expect(versionOf([{ b: "2", a: "1" }])).toBe(one);
    expect(versionOf([{ a: "1", b: "3" }])).not.toBe(one);
    expect(one).toHaveLength(32);
  });
});

describe("errorParams", () => {
  test("lists the arguments a message names, with their kind", () => {
    expect(
      errorParams(
        "{slug} a {count, plural, one {# fois} other {# fois}} le {day, date, long}",
      ),
    ).toEqual([
      { name: "slug", kind: "TEXT" },
      { name: "count", kind: "PLURAL" },
      { name: "day", kind: "DATE" },
    ]);
    expect(errorParams("Rien.")).toEqual([]);
  });
});
