import { describe, expect, test } from "bun:test";
import { parseTsv } from "./tsv";

const HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const row = (cells: (string | number)[]) => cells.join("\t");

describe("parseTsv", () => {
  test("groups the words by line, in reading order, with their boxes", () => {
    const tsv = [
      HEADER,
      row([1, 1, 0, 0, 0, 0, 0, 0, 800, 500, -1, ""]),
      row([4, 1, 1, 1, 1, 0, 10, 10, 300, 20, -1, ""]),
      row([5, 1, 1, 1, 1, 1, 10, 10, 120, 20, 96.5, "REPUBLIQUE"]),
      row([5, 1, 1, 1, 1, 2, 140, 10, 30, 20, 91, "DU"]),
      row([5, 1, 1, 1, 2, 1, 10, 40, 200, 20, 88, "CAMEROUN"]),
      row([5, 1, 2, 1, 1, 1, 10, 90, 50, 20, -1, " "]),
      "",
    ].join("\n");
    const result = parseTsv(tsv);
    expect(result.lines.map((line) => line.text)).toEqual([
      "REPUBLIQUE DU",
      "CAMEROUN",
    ]);
    expect(result.text).toBe("REPUBLIQUE DU\nCAMEROUN");
    expect(result.lines[0]?.words[1]).toEqual({
      text: "DU",
      confidence: 91,
      box: { left: 140, top: 10, width: 30, height: 20 },
    });
  });

  test("an image with no word is no line", () => {
    expect(parseTsv(`${HEADER}\n`)).toEqual({ lines: [], text: "" });
  });

  test("anything but Tesseract's header is refused", () => {
    expect(() => parseTsv("<html>bad gateway</html>")).toThrow(TypeError);
    expect(() => parseTsv("")).toThrow(TypeError);
  });
});
