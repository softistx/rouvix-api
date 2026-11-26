import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// A migration never deletes what data may use: the global collection is only
// added to or changed, so a translation stays readable. Nothing under
// src/migrations that is not a spec may call a delete or drop, except
// `kit/delete-created.ts`, whose `deleteCreatedTranslations` and
// `deleteCreatedDocuments` are what the
// `down` of a migration that only adds messages calls, and only there.
const forbidden =
  /\b(deleteOne|deleteMany|findOneAndDelete|drop|dropCollection|dropDatabase|remove)\s*\(|\b(deleteOne|deleteMany)\s*:/;

const helper = "src/migrations/kit/delete-created.ts";

const sources = async () => {
  const paths: string[] = [];
  for await (const path of new Glob("src/migrations/**/*.ts").scan(".")) {
    if (!path.endsWith(".spec.ts")) paths.push(path);
  }
  return paths;
};

describe("migrations never delete", () => {
  test("no migration or kit file deletes or drops, but the helper", async () => {
    const offenders: string[] = [];
    for (const path of await sources()) {
      if (path === helper) continue;
      if (forbidden.test(await Bun.file(path).text())) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("deleteCreatedTranslations and deleteCreatedDocuments are called in a down only", async () => {
    const misplaced: string[] = [];
    for (const path of await sources()) {
      if (path === helper || path.includes("/kit/")) continue;
      const text = await Bun.file(path).text();
      const down = text.indexOf("async down");
      const calls = [
        text.indexOf("deleteCreatedTranslations("),
        text.indexOf("deleteCreatedDocuments("),
      ].filter((at) => at !== -1);
      const call = calls.length === 0 ? -1 : Math.min(...calls);
      if (call !== -1 && (down === -1 || call < down)) misplaced.push(path);
    }
    expect(misplaced).toEqual([]);
  });
});
