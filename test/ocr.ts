import {
  emptyOcrResult,
  type Ocr,
  OcrError,
  type OcrLine,
  type OcrResult,
} from "@/ocr";
import { checkDigit } from "@/ocr/mrz";

// Lines as OCR gives them, from plain text: one word per space.
export const ocrLines = (texts: readonly string[]): OcrLine[] =>
  texts.map((text, i) => ({
    text,
    words: text.split(" ").map((word, j) => ({
      text: word,
      confidence: 90,
      box: { left: j * 50, top: i * 30, width: 45, height: 25 },
    })),
  }));

export const ocrResultOf = (texts: readonly string[]): OcrResult => ({
  lines: ocrLines(texts),
  text: texts.join("\n"),
});

const pad = (text: string, length: number) =>
  text.padEnd(length, "<").slice(0, length);
const withDigit = (field: string) => `${field}${checkDigit(field)}`;

interface FakeZone {
  number: string;
  surname: string;
  givenNames: string;
  birth: string;
  expiry: string;
}

const zoneNames = (zone: FakeZone) =>
  `${zone.surname.replaceAll(" ", "<")}<<${zone.givenNames.replaceAll(" ", "<")}`;

// The three lines of a card's machine-readable zone (TD1), for a made-up
// holder of a made-up Cameroon card, with valid check digits.
export const fakeMrzTd1 = (zone: FakeZone) => [
  pad(`IDCMR${withDigit(pad(zone.number, 9))}`, 30),
  `${pad(`${withDigit(zone.birth)}M${withDigit(zone.expiry)}CMR`, 29)}0`,
  pad(zoneNames(zone), 30),
];

// The two lines of a passport's zone (TD3), made up likewise.
export const fakeMrzTd3 = (zone: FakeZone) => [
  pad(`P<CMR${zoneNames(zone)}`, 44),
  pad(
    `${withDigit(pad(zone.number, 9))}CMR${withDigit(zone.birth)}F${withDigit(zone.expiry)}`,
    44,
  ),
];

// What a Cameroon CNI reads as, made up: the heading, the labelled names and
// date, the number, and its zone. Nobody's: every value is a fixture.
export const FAKE_CNI = {
  number: "9907315846",
  surname: "ESSAI",
  givenNames: "JEAN PIERRE",
  birthDate: "01.01.1990",
};
export const fakeCniLines = (number = FAKE_CNI.number) => [
  "REPUBLIQUE DU CAMEROUN",
  "REPUBLIC OF CAMEROON",
  "CARTE NATIONALE D'IDENTITE",
  "NOM/SURNAME",
  FAKE_CNI.surname,
  "PRENOMS/GIVEN NAMES",
  FAKE_CNI.givenNames,
  "DATE DE NAISSANCE/DATE OF BIRTH",
  FAKE_CNI.birthDate,
  `N° ${number}`,
];

// An Ocr for specs: it keeps every image it was given and answers what it was
// told (no word by default; `answerOnce` queues an answer for the next read alone),
// or fails while `fail()` holds. Nothing leaves the process.
export function fakeOcr() {
  const images: Uint8Array[] = [];
  const queued: OcrResult[] = [];
  let next: OcrResult = emptyOcrResult;
  let failing: OcrError | null = null;
  const ocr: Ocr = {
    async read(image) {
      images.push(image);
      if (failing) throw failing;
      return queued.shift() ?? next;
    },
  };
  return {
    ...ocr,
    images,
    answer: (lines: readonly string[]) => {
      next = ocrResultOf(lines);
    },
    answerOnce: (lines: readonly string[]) => {
      queued.push(ocrResultOf(lines));
    },
    fail: (retryable = true) => {
      failing = new OcrError("fake OCR is down", retryable);
    },
    recover: () => {
      failing = null;
    },
  };
}
