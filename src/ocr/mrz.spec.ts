import { describe, expect, test } from "bun:test";
import { fakeMrzTd1, fakeMrzTd3, ocrLines } from "~/ocr";
import { checkDigit, findMrz } from "./mrz";

describe("checkDigit", () => {
  test("weights 7, 3, 1, letters from 10, the filler 0", () => {
    // ICAO 9303's own worked example.
    expect(checkDigit("520727")).toBe(3);
    expect(checkDigit("AB2134<<<")).toBe(5);
  });
});

describe("findMrz", () => {
  test("reads a card's three lines (TD1), its number checked", () => {
    const zone = fakeMrzTd1({
      number: "990731584",
      surname: "ESSAI",
      givenNames: "JEAN PIERRE",
      birth: "900101",
      expiry: "300101",
    });
    const mrz = findMrz(ocrLines(["REPUBLIQUE DU CAMEROUN", ...zone]), 2026);
    expect(mrz).toEqual({
      format: "TD1",
      documentCode: "ID",
      issuer: "CMR",
      number: "990731584",
      surname: "ESSAI",
      givenNames: "JEAN PIERRE",
      birthDate: "1990-01-01",
      expiryDate: "2030-01-01",
    });
  });

  test("reads a passport's two lines (TD3), spaces and « as OCR gives them", () => {
    const zone = fakeMrzTd3({
      number: "AA0000017",
      surname: "ESSAI",
      givenNames: "MARIE",
      birth: "050607",
      expiry: "310607",
    }).map((line) => line.replace(/<</g, "«‹").replace(/(.{10})/, "$1 "));
    const mrz = findMrz(ocrLines(zone), 2026);
    expect(mrz).toMatchObject({
      format: "TD3",
      number: "AA0000017",
      surname: "ESSAI",
      givenNames: "MARIE",
      birthDate: "2005-06-07",
    });
  });

  test("a number whose check digit fails is not taken, the names still are", () => {
    const [a = "", b = "", c = ""] = fakeMrzTd1({
      number: "990731584",
      surname: "ESSAI",
      givenNames: "JEAN",
      birth: "900101",
      expiry: "300101",
    });
    const misread = `${a.slice(0, 6)}8${a.slice(7)}`;
    const mrz = findMrz(ocrLines([misread, b, c]), 2026);
    expect(mrz?.number).toBeNull();
    expect(mrz?.surname).toBe("ESSAI");
  });

  test("no zone in ordinary text", () => {
    expect(findMrz(ocrLines(["Téléphone noir", "SAMSUNG"]), 2026)).toBeNull();
  });
});
