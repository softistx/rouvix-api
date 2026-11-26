import {
  type Clock,
  janus,
  type PasswordHasher,
  scryptHasher,
  systemClock,
} from "@softistx/janus";
import { defineModel, permissions } from "@softistx/janus/permissions";
import { createMongoAdapter } from "@softistx/janus-mongo";
import type { Db } from "mongodb";
import { z } from "zod";
import { type Background, background } from "@/shared/background";

export interface AuthOptions {
  // The database janus keeps its users, sessions, tokens and relations in.
  db: Db;
  // `fixedClock()` in tests: sessions expire by it.
  clock?: Clock;
  // scrypt at OWASP's cost by default; a test passes a cheap one.
  hasher?: PasswordHasher;
  // The app's background (src/shared/background.ts): where what nobody waits
  // for runs from.
  background?: Background;
}

// The account: janus's user, with the phone (E.164, normalised by the app
// before it reaches janus) as its login field. A person has one account for
// the platform and the organisations they belong to: it is global, never
// owned by an organisation. `suspendedAt` is an ISO date or null (janus keeps
// JSON): a suspended account still authenticates, so the API can tell it so,
// and passes no guard (src/auth/guards.ts). The sign-in itself, a code sent to
// the phone, waits for an upstream janus release; until then the login field
// only makes the phone unique and findable (`findByLogin`), and no password is
// ever set.
export const Account = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  name: z.string().trim().min(1).max(120),
  locale: z.enum(["fr", "en"]).default("fr"),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  trustScore: z.number().int().min(0).max(100).default(50),
  finderBadge: z.boolean().default(false),
  suspendedAt: z.iso.datetime().nullable().default(null),
});

// Janus, wired for rouvix: one account type, whose sessions are read from
// `Authorization: Bearer` (the BFF keeps the token in its own cookie). Its
// permissions hold who is what, in janus's relations, over two kinds of
// object: the one `platform` (admins, moderators) and one `organisation` per
// tenant (admins, agents). `manage` is the admins', `moderate` the
// moderators' and the platform admins', `work` the agents' and the admins'.
export function createAuth(options: AuthOptions) {
  const clock = options.clock ?? systemClock;
  const store = createMongoAdapter(options.db);
  const accounts = janus({
    user: Account,
    password: { login: "phone", normalize: "none" },
    store: store.store,
    relations: store.relations,
    hasher: options.hasher ?? scryptHasher(),
    clock,
    session: { lifespan: "30d", renewAfter: "1d" },
  });
  const access = permissions({
    model: defineModel({
      subjects: accounts.types,
      types: {
        platform: {
          related: { admins: ["user"], moderators: ["user"] },
          permits: { manage: ["admins"], moderate: ["moderators", "manage"] },
        },
        organisation: {
          related: { admins: ["user"], agents: ["user"] },
          permits: { manage: ["admins"], work: ["agents", "manage"] },
        },
      },
    }),
    store: store.relations,
  });
  return {
    accounts,
    permissions: access,
    clock,
    background: options.background ?? background(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
export type AccountType = Auth["accounts"]["types"][number];
