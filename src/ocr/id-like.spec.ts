import { describe, expect, test } from "bun:test";
import { FAKE_CNI, fakeCniLines, fakeMrzTd1, ocrResultOf } from "~/ocr";
import { compilePatterns, folded, isIdLike, numberTokens } from "./id-like";

const CM = [
  { documentType: "CNI", pattern: "^\\d{8,10}$" },
  { documentType: "PASSPORT", pattern: "^[A-Z]{2}\\d{7}$" },
];
const patterns = compilePatterns(CM, null);

describe("isIdLike", () => {
  test("a card's heading, its title or its zone is enough", () => {
    for (const lines of [
      ["République du Cameroun"],
      ["NATIONAL IDENTITY CARD"],
      ["Passeport"],
      fakeMrzTd1({
        number: "990731584",
        surname: "ESSAI",
        givenNames: "JEAN",
        birth: "900101",
        expiry: "300101",
      }),
      fakeCniLines(),
    ]) {
      expect(isIdLike(ocrResultOf(lines), patterns, 2026)).toBe(true);
    }
  });

  test("a number of the country's pattern counts beside an identity label only", () => {
    expect(
      isIdLike(
        ocrResultOf(["Nom : ESSAI", `N° ${FAKE_CNI.number}`]),
        patterns,
        2026,
      ),
    ).toBe(true);
    // A phone's box: a long number and nothing of an identity.
    expect(
      isIdLike(ocrResultOf(["SAMSUNG", "IMEI 35000000"]), patterns, 2026),
    ).toBe(false);
  });

  test("an object's photo with ordinary words is not", () => {
    for (const lines of [[], ["Portefeuille", "cuir brun"], ["NOKIA 3310"]]) {
      expect(isIdLike(ocrResultOf(lines), patterns, 2026)).toBe(false);
    }
  });
});

describe("the helpers", () => {
  test("folded drops accents and case", () => {
    expect(folded("Prénoms  Né")).toBe("PRENOMS NE");
  });

  test("numberTokens drops the N° and the marks around a number", () => {
    expect(numberTokens("N° 990731584, nom: (AA0000017)")).toEqual([
      "990731584",
      "AA0000017",
    ]);
  });

  test("compilePatterns keeps a type's patterns and skips a broken one", () => {
    const one = compilePatterns(
      [...CM, { documentType: "CNI", pattern: "([" }],
      "CNI",
    );
    expect(one.map(String)).toEqual(["/^\\d{8,10}$/"]);
  });
});
