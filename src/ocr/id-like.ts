import { findMrz } from "./mrz";
import type { OcrResult } from "./ocr";

// A country's ID number pattern, as the config holds it (`Country.idNumberPatterns`).
export interface NumberPattern {
  documentType: string;
  pattern: string;
}

// Text as the checks compare it: upper case, no accent, single spaces.
export const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[ \t]+/g, " ");

// The words of a text that could be a document number: letters, digits and
// the separators numbers carry (`/`, `-`), the marks around them dropped.
export const numberTokens = (text: string) =>
  folded(text)
    .split(/[\s,;:()]+/)
    .map((token) => token.replace(/^N[°O.]*/, "").replace(/[^A-Z0-9/-]/g, ""))
    .filter((token) => token.length >= 4);

// The patterns of a document type, or of every type when it is not known.
// A pattern that does not compile (a config typo) is left out, never thrown.
export function compilePatterns(
  patterns: readonly NumberPattern[],
  documentType: string | null,
): RegExp[] {
  const out: RegExp[] = [];
  for (const entry of patterns) {
    if (documentType !== null && entry.documentType !== documentType) continue;
    try {
      out.push(new RegExp(entry.pattern));
    } catch {
      // skipped: the config's mistake must not break a photo's processing
    }
  }
  return out;
}

const HEADING = /\bREPUBLI(QUE|C)\b/;
const TITLE =
  /CARTE NATIONALE D.?IDENTITE|NATIONAL IDENTITY CARD|\bPASSE?PORT\b|PERMIS DE CONDUIRE|DRIVING LICEN[CS]E|CARTE D.?ETUDIANT|STUDENT CARD|RECEPISSE/;
const LABEL =
  /\bNOM\b|SURNAME|PRENOMS?|GIVEN NAMES?|DATE DE NAISSANCE|DATE OF BIRTH|\bNE\(?E?\)? LE\b|\bSEXE\b/;

// Whether a photo looks like an ID document's (spec §4.3): it has a
// machine-readable zone, a state heading ("RÉPUBLIQUE DU CAMEROUN") or a
// document title, or a word matching one of the country's number patterns
// beside an identity label (a name, a birth date). Such a photo is never sent
// to a remote service and never shown in public but blurred.
export function isIdLike(
  result: OcrResult,
  patterns: readonly RegExp[],
  thisYear: number,
): boolean {
  if (findMrz(result.lines, thisYear) !== null) return true;
  const text = folded(result.text);
  if (HEADING.test(text) || TITLE.test(text)) return true;
  const numbered = numberTokens(text).some((token) =>
    patterns.some((pattern) => pattern.test(token)),
  );
  return numbered && LABEL.test(text);
}
