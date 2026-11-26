import { type Auth, createAuth } from "@/auth/auth";
import { mongo } from "./db";

let built: Auth | undefined;

// The janus the app and the scripts share, built on first use over the app's
// database.
export function serverAuth() {
  built ??= createAuth({ db: mongo.db });
  return built;
}
