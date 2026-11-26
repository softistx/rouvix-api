import type { OcrLine } from "./ocr";

// What the machine-readable zone of an ID document says (ICAO 9303): the
// document number (when its check digit holds), the names, and the dates as
// `YYYY-MM-DD`. `issuer` is the issuing state's three-letter code.
export interface Mrz {
  format: "TD1" | "TD2" | "TD3";
  documentCode: string;
  issuer: string;
  number: string | null;
  surname: string | null;
  givenNames: string | null;
  birthDate: string | null;
  expiryDate: string | null;
}

const MRZ_LINE = /^[A-Z0-9<]+$/;
const WEIGHTS = [7, 3, 1];

// A line as the zone prints it: upper case, no space, the filler `<` (which
// OCR often reads as « or ‹).
const zoneLine = (text: string) =>
  text.toUpperCase().replace(/[«‹]/g, "<").replace(/\s+/g, "");

const value = (char: string) => {
  if (char >= "0" && char <= "9") return Number(char);
  if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55;
  return 0;
};

// The check digit of a field: weights 7, 3, 1 over the characters, modulo 10.
export const checkDigit = (field: string) =>
  [...field].reduce(
    (sum, char, i) => sum + value(char) * (WEIGHTS[i % 3] ?? 0),
    0,
  ) % 10;

const checked = (field: string, digit: string | undefined) =>
  digit !== undefined &&
  /\d/.test(digit) &&
  checkDigit(field) === Number(digit);

const clean = (field: string) => field.replace(/<+$/g, "").replace(/</g, " ");

// `YYMMDD` as a date; a birth year above this year's two digits is the last
// century's, an expiry is this century's. A field that is no date is null.
const dateOf = (field: string, kind: "birth" | "expiry", thisYear: number) => {
  if (!/^\d{6}$/.test(field)) return null;
  const yy = Number(field.slice(0, 2));
  const month = Number(field.slice(2, 4));
  const day = Number(field.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const century = kind === "birth" && yy > thisYear % 100 ? 1900 : 2000;
  return `${century + yy}-${field.slice(2, 4)}-${field.slice(4, 6)}`;
};

const names = (field: string) => {
  const [surname = "", given = ""] = field.replace(/<+$/, "").split("<<");
  return {
    surname: clean(surname).trim() || null,
    givenNames: clean(given).trim() || null,
  };
};

const numberOf = (field: string, digit: string | undefined) =>
  checked(field, digit) ? field.replace(/</g, "") || null : null;

// The zone among the lines OCR read, if any: two lines of 44 (passport, TD3),
// two of 36 (TD2) or three of 30 (card, TD1), one after the other. `thisYear`
// decides the century of a birth date.
export function findMrz(
  lines: readonly OcrLine[],
  thisYear: number,
): Mrz | null {
  const zone = lines
    .map((line) => zoneLine(line.text))
    .filter((line) => MRZ_LINE.test(line) && line.includes("<"));
  for (let i = 0; i < zone.length; i += 1) {
    const [a = "", b = "", c = ""] = zone.slice(i, i + 3);
    if (a.length === 30 && b.length === 30 && c.length === 30) {
      return td1(a, b, c, thisYear);
    }
    if (a.length === 44 && b.length === 44)
      return td2or3("TD3", a, b, thisYear);
    if (a.length === 36 && b.length === 36)
      return td2or3("TD2", a, b, thisYear);
  }
  return null;
}

function td1(a: string, b: string, c: string, thisYear: number): Mrz {
  return {
    format: "TD1",
    documentCode: clean(a.slice(0, 2)).trim(),
    issuer: a.slice(2, 5).replace(/</g, ""),
    number: numberOf(a.slice(5, 14), a[14]),
    ...names(c),
    birthDate: checked(b.slice(0, 6), b[6])
      ? dateOf(b.slice(0, 6), "birth", thisYear)
      : null,
    expiryDate: checked(b.slice(8, 14), b[14])
      ? dateOf(b.slice(8, 14), "expiry", thisYear)
      : null,
  };
}

function td2or3(
  format: "TD2" | "TD3",
  a: string,
  b: string,
  thisYear: number,
): Mrz {
  return {
    format,
    documentCode: clean(a.slice(0, 2)).trim(),
    issuer: a.slice(2, 5).replace(/</g, ""),
    number: numberOf(b.slice(0, 9), b[9]),
    ...names(a.slice(5)),
    birthDate: checked(b.slice(13, 19), b[19])
      ? dateOf(b.slice(13, 19), "birth", thisYear)
      : null,
    expiryDate: checked(b.slice(21, 27), b[27])
      ? dateOf(b.slice(21, 27), "expiry", thisYear)
      : null,
  };
}
