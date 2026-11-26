import { describe, expect, test } from "bun:test";
import { categoryIssues, countryIssues } from "./config.rules";

const documents = new Set(["CNI", "PASSPORT"]);
const country = {
  phonePattern: "^\\+237\\d{9}$",
  documentTypes: ["CNI"],
  idNumberPatterns: [{ documentType: "CNI", pattern: "^\\d{9}$" }],
};

describe("countryIssues", () => {
  test("a sound country has none", () => {
    expect(countryIssues(country, documents)).toEqual([]);
  });

  test("a pattern that is no regular expression is refused on its path", () => {
    const issues = countryIssues(
      {
        ...country,
        phonePattern: "(",
        idNumberPatterns: [{ documentType: "CNI", pattern: "[" }],
      },
      documents,
    );
    expect(issues.map((i) => i.path)).toEqual([
      "phonePattern",
      "idNumberPatterns.0.pattern",
    ]);
    expect(
      issues.every((i) => i.code === "validation.errors.invalid-format"),
    ).toBe(true);
  });

  test("a document type that is no live document category is refused, with its index", () => {
    const issues = countryIssues(
      { ...country, documentTypes: ["CNI", "NOPE"] },
      documents,
    );
    expect(issues).toEqual([
      {
        path: "documentTypes.1",
        code: "config.errors.document-type-unknown",
        params: { key: "NOPE" },
      },
    ]);
  });

  test("a pattern for a document type the country does not offer is refused", () => {
    const issues = countryIssues(
      {
        ...country,
        idNumberPatterns: [{ documentType: "PASSPORT", pattern: "^x$" }],
      },
      documents,
    );
    expect(issues.map((i) => i.path)).toEqual([
      "idNumberPatterns.0.documentType",
    ]);
  });
});

describe("categoryIssues", () => {
  const root = { parent: null, isDocument: true };
  const input = { key: "CNI", parent: "DOCUMENT", isDocument: true };
  const reasonOf = (issues: ReturnType<typeof categoryIssues>) =>
    issues[0]?.params?.["reason"];

  test("a root, or a child of a root of the same kind, has none", () => {
    expect(
      categoryIssues({ ...input, parent: null }, undefined, false),
    ).toEqual([]);
    expect(categoryIssues(input, root, false)).toEqual([]);
  });

  test("each way a parent can be wrong has its reason, on `parent`", () => {
    expect(
      reasonOf(categoryIssues({ ...input, parent: "CNI" }, root, false)),
    ).toBe("self");
    expect(reasonOf(categoryIssues(input, undefined, false))).toBe("unknown");
    expect(
      reasonOf(categoryIssues(input, { parent: "X", isDocument: true }, false)),
    ).toBe("notroot");
    expect(reasonOf(categoryIssues(input, root, true))).toBe("haschildren");
    expect(
      reasonOf(
        categoryIssues(input, { parent: null, isDocument: false }, false),
      ),
    ).toBe("document");
    expect(categoryIssues(input, undefined, false)[0]?.path).toBe("parent");
  });
});
