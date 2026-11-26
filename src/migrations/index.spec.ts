import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { migrations } from "./index";

describe("the migrations list", () => {
  test("holds each migration once, by id", () => {
    const ids = migrations.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("lists every <id>.migration.ts of the folder, ids as YYYY-MM-DD-<slug>", async () => {
    const files: string[] = [];
    for await (const path of new Glob("*.migration.ts").scan(import.meta.dir)) {
      files.push(path.replace(/\.migration\.ts$/, ""));
    }
    expect(migrations.map((m) => m.id).sort()).toEqual(files.sort());
    for (const id of files)
      expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  });

  test("every migration has a down", () => {
    for (const migration of migrations) {
      expect(typeof migration.down).toBe("function");
    }
  });
});
