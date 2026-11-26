import type { OcrLine, OcrResult, OcrWord } from "./ocr";

const COLUMNS = [
  "level",
  "page_num",
  "block_num",
  "par_num",
  "line_num",
  "word_num",
  "left",
  "top",
  "width",
  "height",
  "conf",
  "text",
] as const;

const WORD_LEVEL = "5";

// Tesseract's TSV output (`tesseract … tsv`) as lines of words: the rows of
// level 5 (a word) with some text, grouped by their block, paragraph and line,
// in the order Tesseract read them. A header that is not Tesseract's is an
// error: the sidecar answered something else.
export function parseTsv(tsv: string): OcrResult {
  const [header, ...rows] = tsv.split(/\r?\n/);
  if (header?.trim() !== COLUMNS.join("\t")) {
    throw new TypeError("not Tesseract's TSV output");
  }
  const lines = new Map<string, OcrWord[]>();
  for (const row of rows) {
    const cells = row.split("\t");
    if (cells.length < COLUMNS.length || cells[0] !== WORD_LEVEL) continue;
    const text = cells.slice(11).join("\t").trim();
    if (text === "") continue;
    const [, page, block, par, line, , left, top, width, height, conf] =
      cells.map(Number);
    const word: OcrWord = {
      text,
      confidence: Math.max(0, conf ?? 0),
      box: {
        left: left ?? 0,
        top: top ?? 0,
        width: width ?? 0,
        height: height ?? 0,
      },
    };
    const id = `${page}/${block}/${par}/${line}`;
    lines.set(id, [...(lines.get(id) ?? []), word]);
  }
  const out: OcrLine[] = [...lines.values()].map((words) => ({
    text: words.map((word) => word.text).join(" "),
    words,
  }));
  return { lines: out, text: out.map((line) => line.text).join("\n") };
}
