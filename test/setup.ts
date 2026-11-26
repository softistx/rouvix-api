import { afterAll } from "bun:test";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

// Preloaded by `bun test` (bunfig.toml), before any spec imports src/: one
// in-memory MongoDB, a one-node replica set so that transactions work, for
// the whole run. src/config/env.ts then reads its URI as MONGO_URI.
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: "wiredTiger" },
});
Bun.env["MONGO_URI"] = replSet.getUri("rouvix-test");
// Specs never reach a Redis of the developer's .env, nor a real SMS provider:
// they inject their own ports.
delete Bun.env["REDIS_URL"];
// Nor the developer's OCR sidecar: the ID document specs inject a fake OCR, and
// the vault is a key of the run.
delete Bun.env["OCR_URL"];
delete Bun.env["ID_FIELDS_KEY"];
Bun.env["SMS_PROVIDER"] = "log";

// Every collection and its indexes, before any spec, then the migrations and
// the catalogues they write: the app's (autoSync would create one on first
// use, which a transaction cannot do: a spec whose first write to a
// collection is in a transaction would hang), and janus's (users, sessions,
// tokens, relations), which nothing syncs alone.
{
  const { mongo } = await import("@/config/db");
  const { syncJanus } = await import("@/config/janus-sync");
  await mongo.sync();
  await syncJanus(mongo.db);
  // The translations the API speaks, as in production: the migrations, once
  // for the run (`clearDatabase` keeps what they wrote), then `loadCatalogues`.
  const { bootCatalogues } = await import("@/modules/translations");
  await bootCatalogues(mongo, { autoMigrate: true });
}

// The run's last hook: it closes the client and stops the replica set.
afterAll(async () => {
  const { mongo } = await import("@/config/db");
  await mongo.close();
  await replSet.stop();
}, 60_000);
