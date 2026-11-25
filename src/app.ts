import { health } from "@softistx/alxia";
import { graphql } from "@softistx/alxia-graphql";
import type { Mailer } from "@softistx/mail";
import { janusAccess, janusViewer } from "./auth/access";
import type { Auth } from "./auth/auth";
import { serverAuth } from "./config/auth";
import { mongo } from "./config/db";
import { env } from "./config/env";
import { redis } from "./config/redis";
import { serverSms } from "./config/sms";
import { type BaseOptions, createBase } from "./http/context";
import { graphqlOptions, type ReportUnexpected } from "./http/graphql-endpoint";
import { noStoreMiddleware } from "./http/no-store";
import { serverMailer } from "./mail/mailer";
import { cataloguesLoaded } from "./modules/translations";
import type { Now } from "./shared/dates";
import type { SmsSender } from "./sms";
import { organisationDirectory } from "./tenancy";

export type AppOptions = Partial<Omit<BaseOptions, "trusted">> & {
  auth?: Auth;
  sms?: SmsSender;
  mailer?: Mailer;
  catalogues?: () => boolean;
  now?: Now;
  onUnexpected?: ReportUnexpected;
};

// The app's entry point, where the ports are defaulted to the server's own
// (janus for the viewer and its access, the SMS adapter and the mailer chosen
// by the environment) so a spec injects only what it fakes. Everything below
// receives them explicitly.
export function createApp(options: AppOptions = {}) {
  const auth = options.auth ?? serverAuth();
  const sms = options.sms ?? serverSms();
  const mailer = options.mailer ?? serverMailer(env.MAIL_URL);
  const cataloguesReady = options.catalogues ?? cataloguesLoaded;
  const now = options.now ?? (() => new Date());
  return createBase({
    resolveViewer: options.resolveViewer ?? janusViewer(auth),
    access: options.access ?? janusAccess(auth),
    organisations: options.organisations ?? organisationDirectory(mongo),
    trusted: env.TRUSTED_PROXIES,
    proxySecret: options.proxySecret ?? env.PROXY_SECRET,
  })
    .plugin(probes(cataloguesReady))
    .use("/graphql", noStoreMiddleware)
    .plugin((app) =>
      graphql(
        app,
        graphqlOptions({ mongo, auth, sms, mailer, now }, options.onUnexpected),
      ),
    )
    .onStop(async () => {
      await mongo.close();
      await redis?.close();
    });
}

// /health says the process is up; /ready says it can serve: MongoDB answers a
// ping within a second, Redis too where it is configured, and the catalogues
// have loaded. 503 until then.
function probes(cataloguesReady: () => boolean) {
  return health({
    checks: {
      mongo: async () =>
        Object.values(await mongo.ping({ timeoutMS: 1_000 })).every(
          (result) => result.ok,
        ),
      redis: async () =>
        redis === undefined || (await redis.ping({ timeoutMs: 1_000 })).ok,
      catalogues: async () => cataloguesReady(),
    },
  });
}

export const app = createApp();

export type App = typeof app;
