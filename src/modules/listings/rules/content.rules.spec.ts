import { describe, expect, test } from "bun:test";
import {
  type ContentRulesInput,
  contentIssues,
  type RulesLookups,
} from "./content.rules";

const today = new Date("2026-11-27T00:00:00.000Z");
const key = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

const lookups = (over: Partial<RulesLookups> = {}): RulesLookups => ({
  category: { isDocument: false },
  documentTypes: ["CNI", "PASSPORT"],
  today,
  free: new Set([key(1), key(2)]),
  ...over,
});
const lost = (over: Partial<ContentRulesInput> = {}): ContentRulesInput => ({
  kind: "LOST",
  categoryKey: "PHONE",
  documentType: null,
  date: today,
  radiusM: 500,
  keptAt: null,
  questionCount: 0,
  photoKeys: [],
  inRegister: false,
  ...over,
});
const found = (over: Partial<ContentRulesInput> = {}): ContentRulesInput =>
  lost({
    kind: "FOUND",
    radiusM: null,
    keptAt: "WITH_FINDER",
    questionCount: 1,
    ...over,
  });
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe("a sound listing", () => {
  test("a lost and a found one have no issue", () => {
    expect(contentIssues(lost(), lookups())).toEqual([]);
    expect(contentIssues(found(), lookups())).toEqual([]);
  });
});

describe("the category and the document type", () => {
  test("an unknown category is refused on categoryKey", () => {
    const issues = contentIssues(lost(), lookups({ category: undefined }));
    expect(issues).toEqual([
      {
        path: "categoryKey",
        code: "listings.errors.category-invalid",
        params: { key: "PHONE" },
      },
    ]);
  });

  test("a documents category needs a document type the country offers, another has none", () => {
    const document = lookups({ category: { isDocument: true } });
    const reasonOf = (input: ContentRulesInput, l: RulesLookups) =>
      contentIssues(input, l)[0]?.params?.["reason"];
    expect(reasonOf(lost({ documentType: null }), document)).toBe("required");
    expect(reasonOf(lost({ documentType: "VISA" }), document)).toBe("unknown");
    expect(contentIssues(lost({ documentType: "CNI" }), document)).toEqual([]);
    expect(reasonOf(lost({ documentType: "CNI" }), lookups())).toBe(
      "unexpected",
    );
  });
});

describe("the date", () => {
  test("today passes, tomorrow is out of range", () => {
    expect(contentIssues(lost({ date: today }), lookups())).toEqual([]);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    expect(paths(contentIssues(lost({ date: tomorrow }), lookups()))).toEqual([
      "date",
    ]);
  });
});

describe("a lost item", () => {
  test("has a radius from 200 m to 20 km, no whereabouts and no question", () => {
    expect(paths(contentIssues(lost({ radiusM: null }), lookups()))).toEqual([
      "place.radiusM",
    ]);
    expect(paths(contentIssues(lost({ radiusM: 199 }), lookups()))).toEqual([
      "place.radiusM",
    ]);
    expect(paths(contentIssues(lost({ radiusM: 20_001 }), lookups()))).toEqual([
      "place.radiusM",
    ]);
    expect(contentIssues(lost({ radiusM: 200 }), lookups())).toEqual([]);
    expect(contentIssues(lost({ radiusM: 20_000 }), lookups())).toEqual([]);
    expect(
      paths(contentIssues(lost({ keptAt: "AT_POLICE" }), lookups())),
    ).toEqual(["place.keptAt"]);
    expect(paths(contentIssues(lost({ questionCount: 1 }), lookups()))).toEqual(
      ["questions"],
    );
  });
});

describe("a found item", () => {
  test("has a whereabouts, no radius and one to three questions", () => {
    expect(paths(contentIssues(found({ keptAt: null }), lookups()))).toEqual([
      "place.keptAt",
    ]);
    expect(paths(contentIssues(found({ radiusM: 500 }), lookups()))).toEqual([
      "place.radiusM",
    ]);
    expect(
      paths(contentIssues(found({ questionCount: 0 }), lookups())),
    ).toEqual(["questions"]);
    expect(
      paths(contentIssues(found({ questionCount: 4 }), lookups())),
    ).toEqual(["questions"]);
    expect(contentIssues(found({ questionCount: 3 }), lookups())).toEqual([]);
  });
});

describe("the photos", () => {
  test("each key must be one the author uploaded and no listing carries, once", () => {
    const issues = contentIssues(
      lost({ photoKeys: [key(1), key(1), key(9)] }),
      lookups(),
    );
    expect(issues).toEqual([
      {
        path: "photoKeys.1",
        code: "listings.errors.photo-invalid",
        params: { reason: "duplicate" },
      },
      {
        path: "photoKeys.2",
        code: "listings.errors.photo-invalid",
        params: { reason: "unknown" },
      },
    ]);
  });

  test("five photos at most", () => {
    const six = [1, 2, 3, 4, 5, 6].map(key);
    const free = new Set(six);
    expect(
      paths(contentIssues(lost({ photoKeys: six }), lookups({ free }))),
    ).toEqual(["photoKeys"]);
    expect(
      contentIssues(lost({ photoKeys: six.slice(0, 5) }), lookups({ free })),
    ).toEqual([]);
  });
});
