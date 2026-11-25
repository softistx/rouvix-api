import { syncMongoAdapter } from "@softistx/janus-mongo";
import { mongo } from "@/config/db";

// A deployment step: brings every collection's validator and indexes to what
// its definition says and prints what changed. It needs the dbAdmin role,
// which the app itself should not hold. janus's collections are synced beside
// the app's own.
try {
  console.log(
    JSON.stringify(
      { app: await mongo.sync(), janus: await syncMongoAdapter(mongo.db) },
      null,
      2,
    ),
  );
} finally {
  await mongo.close();
}
