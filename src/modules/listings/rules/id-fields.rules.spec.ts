import { describe, expect, test } from "bun:test";
import { compilePatterns } from "@/ocr";
import { FAKE_CNI, fakeCniLines, fakeMrzTd1, ocrResultOf } from "~/ocr";
import {
  mergeIdFields,
  noIdFields,
  normaliseNumber,
  readIdFields,
} from "./id-fields.rules";

const cni = compilePatterns(
  [{ documentType: "CNI", pattern: "^\\d{8,10}$" }],
  "CNI",
);

describe("readIdFields", () => {
  test("reads a card's labelled names, birth date and number", () => {
    expect(readIdFields(ocrResultOf(fakeCniLines()), cni, 2026)).toEqual({
      number: FAKE_CNI.number,
      surname: "ESSAI",
      givenNames: "JEAN PIERRE",
      birthDate: "1990-01-01",
      expiryDate: null,
    });
  });

  test("a value on the label's own line, accents folded", () => {
    const fields = readIdFields(
      ocrResultOf([
        "Nom : Essai",
        "Prénoms : Jean",
        "Né le 02/03/1991 à Nulle Part",
        "Numéro 99-0731-5846",
      ]),
      cni,
      2026,
    );
    expect(fields).toMatchObject({
      surname: "ESSAI",
      givenNames: "JEAN",
      birthDate: "1991-03-02",
    });
  });

  test("the zone wins where it reads a field, the text fills the rest", () => {
    const zone = fakeMrzTd1({
      number: "990731584",
      surname: "ZONE",
      givenNames: "MARIE",
      birth: "900101",
      expiry: "300101",
    });
    const fields = readIdFields(
      ocrResultOf(["NOM/SURNAME", "ESSAI", ...zone]),
      cni,
      2026,
    );
    expect(fields).toEqual({
      number: "990731584",
      surname: "ZONE",
      givenNames: "MARIE",
      birthDate: "1990-01-01",
      expiryDate: "2030-01-01",
    });
  });

  test("a number of no pattern of the type, or no text, reads nothing", () => {
    expect(readIdFields(ocrResultOf(["N° 12"]), cni, 2026)).toEqual(noIdFields);
    expect(readIdFields(ocrResultOf([]), cni, 2026)).toEqual(noIdFields);
  });
});

describe("the helpers", () => {
  test("normaliseNumber keeps letters and digits, upper case", () => {
    expect(normaliseNumber(" aa-000 0017/ ")).toBe("AA0000017");
  });

  test("mergeIdFields takes each field from the first photo that read it", () => {
    expect(
      mergeIdFields([
        { ...noIdFields, surname: "ESSAI" },
        { ...noIdFields, surname: "AUTRE", number: "9907315846" },
      ]),
    ).toEqual({ ...noIdFields, surname: "ESSAI", number: "9907315846" });
  });
});
