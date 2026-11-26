import { graphqlClient } from "@softistx/alxia-graphql/testing";
import { fixedClock, scryptHasher } from "@softistx/janus";
import { createMemoryMailer } from "@softistx/mail";
import { createApp } from "@/app";
import { createAuth } from "@/auth/auth";
import { mongo } from "@/config/db";
import { clientHeader } from "@/http/csrf";
import { localRedactor } from "@/redactor";
import type { Throttle } from "@/throttle";
import { ephemeralIdVault } from "@/vault";
import { fakeClaude, fakeOllama } from "~/ai";
import { memoryBucket } from "~/bucket";
import { fakeGeocoder } from "~/geocoder";
import { fakeOcr } from "~/ocr";
import { fakePush } from "~/push";
import { memorySmsSender } from "~/sms";

// The app with the REAL janus, its stores in the test database: a memory
// mailer and SMS sender whose outboxes a spec reads, a fixed clock it moves
// (sessions expire by it) and a cheap hasher; the fake OCR (it reads no word
// unless told), the real in-process blur and a vault of its own key. Each call
// builds its own, so a spec moving its clock moves no other's.
export function authApp(options: { throttle?: Throttle } = {}) {
  const clock = fixedClock(Date.now());
  const mailer = createMemoryMailer();
  const sms = memorySmsSender();
  const push = fakePush();
  const geocoder = fakeGeocoder();
  const storage = memoryBucket();
  const ocr = fakeOcr();
  const claude = fakeClaude();
  const ollama = fakeOllama();
  const redactor = localRedactor();
  const vault = ephemeralIdVault();
  const auth = createAuth({
    db: mongo.db,
    clock,
    hasher: scryptHasher({ cost: 10 }),
  });
  const app = createApp({
    auth,
    sms,
    mailer,
    push,
    geocoder,
    media: storage.bucket,
    ocr,
    redactor,
    vault,
    describer: claude.describer,
    embedder: ollama.embedder,
    ...(options.throttle && { throttle: options.throttle }),
    now: () => new Date(clock.now()),
  });
  // A client sending the session `token` as a bearer, and `language` as
  // accept-language (French without one); anonymous without a token. It sends
  // x-rouvix-client, as every client must (src/http/csrf.ts).
  const client = (token?: string | null, language?: string) =>
    graphqlClient(app, {
      headers: {
        [clientHeader]: "spec",
        ...(token && { authorization: `Bearer ${token}` }),
        ...(language && { "accept-language": language }),
      },
    });
  return {
    auth,
    app,
    mailer,
    sms,
    push,
    geocoder,
    storage,
    ocr,
    claude,
    ollama,
    redactor,
    vault,
    clock,
    client,
  };
}

export type AuthApp = ReturnType<typeof authApp>;
