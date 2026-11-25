import { MigrationLockedError } from "@softistx/mongo/migrations";
import { app } from "./app";
import { mongo } from "./config/db";
import { env } from "./config/env";
import { syncJanus } from "./config/janus-sync";
import { redis } from "./config/redis";
import { MigrationsOutOfSyncError } from "./migrations/status";
import { bootCatalogues } from "./modules/translations";

const development = Bun.env.NODE_ENV !== "production";
if (development) await syncJanus(mongo.db);

try {
  await bootCatalogues(mongo, { autoMigrate: development });
} catch (error) {
  if (
    !(error instanceof MigrationsOutOfSyncError) &&
    !(error instanceof MigrationLockedError)
  ) {
    throw error;
  }
  console.error(error.message);
  process.exit(1);
}

if (redis === undefined) console.warn("redis off: no REDIS_URL");

app.listen({
  port: env.PORT,
  idleTimeout: 30,
  onListen: ({ dev, table, url }) =>
    console.log(dev ? table : `listening on ${url}`),
});
