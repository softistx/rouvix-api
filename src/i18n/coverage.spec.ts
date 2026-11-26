import { describe, expect, test } from "bun:test";
import { parseMessage } from "@softistx/i18n";
import { Glob } from "bun";
import { mongo } from "@/config/db";
import { LANGUAGES } from "@/modules/translations/translations.load";
import { type ErrorCode, errorCodes } from "./codes";
import { dateParams } from "./params";

// The inventory in code (`ErrorCode`) against the messages in the database
// (the first migration, plus any later one): every code is translated in every
// shipped language, with the same arguments, and no code hides in the source.
const rows = await mongo.db.translations.raw.find({}).toArray();
const byKey = new Map(rows.map((row) => [row._id, row]));

const shape = (text: string) =>
  parseMessage(text)
    .map(({ name, kind }) => `${name}:${kind}`)
    .sort()
    .join(",");

describe("the error codes and their translations", () => {
  test("the inventory has no code twice", () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });

  test("french and english are shipped", () => {
    expect(LANGUAGES).toEqual(["fr", "en"]);
  });

  test("every code has a live message in every shipped language", () => {
    const missing = errorCodes.flatMap((code) => {
      const row = byKey.get(code);
      return LANGUAGES.filter(
        (language) => row === undefined || !row.texts[language],
      ).map((language) => `${code} (${language})`);
    });
    expect(missing).toEqual([]);
  });

  test("every translation of a code namespace is a code of the inventory", () => {
    const known = new Set<string>(errorCodes);
    const strays = rows
      .filter((row) => /\.errors$/.test(row.namespace))
      .filter((row) => !known.has(row._id))
      .map((row) => row._id);
    expect(strays).toEqual([]);
  });

  test("no French text has a plain space before ? : ; !", () => {
    const plain = rows
      .filter((row) => / [?:;!]/.test(row.texts["fr"] ?? ""))
      .map((row) => row._id);
    expect(plain).toEqual([]);
  });

  test("every message is valid ICU", () => {
    const invalid = rows.flatMap((row) =>
      Object.entries(row.texts).flatMap(([language, text]) => {
        try {
          parseMessage(text);
          return [];
        } catch (error) {
          return [`${row._id} (${language}): ${String(error)}`];
        }
      }),
    );
    expect(invalid).toEqual([]);
  });

  test("every language of a key names the same arguments, of the same kind", () => {
    const differing = rows.flatMap((row) => {
      const [first, ...others] = Object.values(row.texts).map(shape);
      return others.every((n) => n === first) ? [] : [row._id];
    });
    expect(differing).toEqual([]);
  });

  test("a parameter listed as a date is a date argument wherever it appears", () => {
    const misused = rows.flatMap((row) =>
      Object.values(row.texts).flatMap((text) =>
        parseMessage(text)
          .filter((a) => dateParams.has(a.name) && a.kind !== "date")
          .map((a) => `${row._id}: ${a.name}`),
      ),
    );
    expect(misused).toEqual([]);
  });

  test("no code appears in the source that the inventory lacks", async () => {
    const known = new Set<string>(errorCodes);
    const literal = /["'`]([a-z][a-z-]*\.errors\.[a-z0-9-]+)["'`]/g;
    const strays: string[] = [];
    for await (const path of new Glob("src/**/*.ts").scan(".")) {
      if (/\.spec\.ts$|^src\/generated\//.test(path)) continue;
      const text = await Bun.file(path).text();
      for (const [, code] of text.matchAll(literal)) {
        if (!known.has(code as ErrorCode)) strays.push(`${path}: ${code}`);
      }
    }
    expect(strays).toEqual([]);
  });

  test("CONTEXT.md lists every code in its Error codes table", async () => {
    const context = await Bun.file("CONTEXT.md").text();
    const table = context.slice(context.indexOf("## Error codes"));
    const unlisted = errorCodes.filter(
      (code) => !table.includes(`\`${code}\``),
    );
    expect(unlisted).toEqual([]);
  });
});
