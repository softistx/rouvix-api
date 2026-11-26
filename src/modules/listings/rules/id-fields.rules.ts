import { findMrz, folded, numberTokens, type OcrResult } from "@/ocr";

// What the local OCR read of an ID document (spec §4.2), kept sealed in
// `idFields`: the number in its normalised form, the names as printed, the
// dates as `YYYY-MM-DD`. Each is null when it was not read.
export interface IdFields {
  number: string | null;
  surname: string | null;
  givenNames: string | null;
  birthDate: string | null;
  expiryDate: string | null;
}

export const noIdFields: IdFields = {
  number: null,
  surname: null,
  givenNames: null,
  birthDate: null,
  expiryDate: null,
};

// A number as it is compared and hashed: its letters and digits, upper case.
export const normaliseNumber = (raw: string) =>
  folded(raw).replace(/[^A-Z0-9]/g, "");

const GIVEN = /PRENOMS?|GIVEN NAMES?/;
const SURNAME = /(?<!PRE)NOMS?\b|SURNAME/;
const BIRTH = /DATE DE NAISSANCE|DATE OF BIRTH|\bNE\(?E?\)? LE\b/;
const NUMBER_LABEL = /\bN[°O]\b|N°|NUMERO|NUMBER|\bNO\./;
const LABEL_SOURCE = [GIVEN, SURNAME, BIRTH].map((l) => l.source).join("|");
const ANY_LABEL = new RegExp(LABEL_SOURCE);
const EVERY_LABEL = new RegExp(LABEL_SOURCE, "g");
const NAME = /^[A-Z][A-Z' -]{1,59}$/;
const DATE = /(\d{2})[./-](\d{2})[./-](\d{4})/;

// The value a label introduces: what follows it on its line ("NOM : ESSAI"),
// else the next line when this one is labels only ("NOM/SURNAME", then "ESSAI").
function labelled(lines: readonly string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (!label.test(line)) continue;
    const rest = line
      .replace(EVERY_LABEL, " ")
      .replace(/^[\s/:]+|[\s/:]+$/g, "");
    if (rest !== "") return rest.replace(/\s+/g, " ");
    const next = lines[i + 1];
    if (next !== undefined && !ANY_LABEL.test(next)) return next.trim();
  }
  return null;
}

const nameOf = (value: string | null) =>
  value !== null && NAME.test(value) ? value : null;

const dateOf = (value: string | null) => {
  const found = value === null ? null : DATE.exec(value);
  return found ? `${found[3]}-${found[2]}-${found[1]}` : null;
};

// The first word that matches one of the country's number patterns, read on a
// line that names a number ("N° …") before any other line.
function numberOf(lines: readonly string[], patterns: readonly RegExp[]) {
  const ordered = [
    ...lines.filter((line) => NUMBER_LABEL.test(line)),
    ...lines.filter((line) => !NUMBER_LABEL.test(line)),
  ];
  for (const line of ordered) {
    for (const token of numberTokens(line)) {
      const number = normaliseNumber(token);
      if (patterns.some((pattern) => pattern.test(number))) return number;
    }
  }
  return null;
}

// The fields of one photo of an ID document: its machine-readable zone first
// (its check digits hold), then the labelled text for what the zone lacks.
// `patterns` are the country's number patterns for the document's type.
export function readIdFields(
  result: OcrResult,
  patterns: readonly RegExp[],
  thisYear: number,
): IdFields {
  const mrz = findMrz(result.lines, thisYear);
  const lines = result.lines.map((line) => folded(line.text).trim());
  const text: IdFields = {
    number: numberOf(lines, patterns),
    surname: nameOf(labelled(lines, SURNAME)),
    givenNames: nameOf(labelled(lines, GIVEN)),
    birthDate: dateOf(labelled(lines, BIRTH)),
    expiryDate: null,
  };
  if (mrz === null) return text;
  return mergeIdFields([
    {
      number: mrz.number === null ? null : normaliseNumber(mrz.number),
      surname: mrz.surname,
      givenNames: mrz.givenNames,
      birthDate: mrz.birthDate,
      expiryDate: mrz.expiryDate,
    },
    text,
  ]);
}

// The fields of several photos (a card's front and back): for each, the first
// one read.
export function mergeIdFields(all: readonly IdFields[]): IdFields {
  const pick = <K extends keyof IdFields>(key: K) =>
    all.map((fields) => fields[key]).find((value) => value !== null) ?? null;
  return {
    number: pick("number"),
    surname: pick("surname"),
    givenNames: pick("givenNames"),
    birthDate: pick("birthDate"),
    expiryDate: pick("expiryDate"),
  };
}
