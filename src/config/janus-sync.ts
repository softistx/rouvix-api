import { syncMongoAdapter } from "@softistx/janus-mongo";
import type { Db } from "mongodb";

// janus's collections (users, sessions, tokens, relations): the validators and
// indexes nothing else creates. Development and tests run it at boot,
// production runs `bun run db:sync`.
export const syncJanus = (db: Db) => syncMongoAdapter(db);
