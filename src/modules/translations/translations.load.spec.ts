import { describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { i18n } from "@/i18n";
import { errorCodes } from "@/i18n/codes";
import { migrations } from "@/migrations";
import { MigrationsOutOfSyncError } from "@/migrations/status";
import { freshMigrationDb } from "~/migrations";
import {
  bootCatalogues,
  cataloguesLoaded,
  catalogueVersion,
  errorMessages,
  loadCatalogues,
} from "./translations.load";

// The same collections on the fresh database of freshMigrationDb.
const fresh = () =>
  mongo.database("rouvix-migrations-test") as unknown as typeof mongo;

describe("the loaded catalogues", () => {
  test("are loaded, and serve every error code in both languages", () => {
    expect(cataloguesLoaded()).toBe(true);
    for (const language of ["fr", "en"]) {
      expect(errorMessages(language).map((m) => m.code)).toEqual([
        ...errorCodes,
      ]);
      expect(catalogueVersion(language)).toHaveLength(32);
    }
    expect(catalogueVersion("fr")).not.toBe(catalogueVersion("en"));
    expect(catalogueVersion("de")).toBe("");
  });

  test("translate an error in the requested language", async () => {
    const fr = await i18n.t("auth.errors.forbidden");
    expect(fr).toBe("Vous n'avez pas le droit de faire cela.");
  });
});

describe("loadCatalogues", () => {
  test("refuses a database with a pending migration", async () => {
    await freshMigrationDb();
    const other = fresh();
    const error = await loadCatalogues(other, migrations).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MigrationsOutOfSyncError);
    expect((error as MigrationsOutOfSyncError).pending).toHaveLength(
      migrations.length,
    );
  });

  test("a development boot applies the pending migrations, then loads", async () => {
    const db = await freshMigrationDb();
    await bootCatalogues(fresh(), {
      autoMigrate: true,
    });
    expect(
      await db.collection("translations").countDocuments(),
    ).toBeGreaterThan(10);
    await bootCatalogues(mongo, { autoMigrate: false });
    expect(cataloguesLoaded()).toBe(true);
  });
});
