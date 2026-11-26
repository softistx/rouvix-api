import { health } from "@softistx/alxia";
import { graphql } from "@softistx/alxia-graphql";
import type { MediaBucket } from "@softistx/alxia-media";
import type { Mailer } from "@softistx/mail";
import { janusAccess, janusViewer } from "./auth/access";
import type { Auth } from "./auth/auth";
import { serverDescriber, serverEmbedder } from "./config/ai";
import { serverAuth } from "./config/auth";
import { mongo } from "./config/db";
import { env } from "./config/env";
import { serverGeocoder } from "./config/geocoder";
import {
  serverIdVault,
  serverOcr,
  serverRedactor,
} from "./config/id-documents";
import { serverMedia } from "./config/media";
import { serverPush } from "./config/push";
import { redis } from "./config/redis";
import { serverSms } from "./config/sms";
import { serverThrottle } from "./config/throttle";
import type { ObjectDescriber } from "./describer";
import type { Embedder } from "./embedder";
import type { Geocoder } from "./geocoder";
import { type BaseOptions, createBase } from "./http/context";
import { graphqlOptions, type ReportUnexpected } from "./http/graphql-endpoint";
import { mediaApp } from "./http/media";
import { noStoreMiddleware } from "./http/no-store";
import { serverMailer } from "./mail/mailer";
import { embeddingRanker } from "./modules/ai";
import { ListingEmbeddings } from "./modules/listings";
import { type ListingRanker, textRanker } from "./modules/search";
import { cataloguesLoaded } from "./modules/translations";
import type { Ocr } from "./ocr";
import type { PushSender } from "./push";
import type { ImageRedactor } from "./redactor";
import type { Now } from "./shared/dates";
import type { SmsSender } from "./sms";
import { organisationDirectory } from "./tenancy";
import type { IdVault } from "./vault";

export type AppOptions = Partial<Omit<BaseOptions, "trusted">> & {
  auth?: Auth;
  sms?: SmsSender;
  geocoder?: Geocoder;
  ranker?: ListingRanker;
  describer?: ObjectDescriber;
  embedder?: Embedder;
  claudeDailyCap?: number;
  media?: MediaBucket;
  ocr?: Ocr;
  redactor?: ImageRedactor;
  vault?: IdVault;
  mailer?: Mailer;
  push?: PushSender;
  catalogues?: () => boolean;
  now?: Now;
  onUnexpected?: ReportUnexpected;
};

// The app's entry point, where the ports are defaulted to the server's own
// (janus for the viewer and its access, the SMS adapter and the mailer chosen
// by the environment, the local OCR, blur and vault of the ID documents, Claude's
// describer and the local embedder) so a
// spec injects only what it fakes. Everything below receives them explicitly.
export function createApp(options: AppOptions = {}) {
  const auth = options.auth ?? serverAuth();
  const sms = options.sms ?? serverSms();
  const geocoder = options.geocoder ?? serverGeocoder();
  const embedder = options.embedder ?? serverEmbedder();
  const describer = options.describer ?? serverDescriber();
  const ranker =
    options.ranker ??
    embeddingRanker({
      embedder,
      vectorsOf: (ids, model) => new ListingEmbeddings(mongo).of(ids, model),
      fallback: textRanker,
    });
  const media = options.media ?? serverMedia;
  const ocr = options.ocr ?? serverOcr();
  const redactor = options.redactor ?? serverRedactor();
  const vault = options.vault ?? serverIdVault();
  const mailer = options.mailer ?? serverMailer(env.MAIL_URL);
  const push = options.push ?? serverPush();
  const cataloguesReady = options.catalogues ?? cataloguesLoaded;
  const now = options.now ?? (() => new Date());
  const access = options.access ?? janusAccess(auth);
  const deps = {
    mongo,
    auth,
    sms,
    mailer,
    push,
    mail: { from: env.MAIL_FROM, uiUrl: env.UI_URL },
    geocoder,
    media,
    ocr,
    redactor,
    vault,
    ranker,
    describer,
    embedder,
    claudeDailyCap: options.claudeDailyCap ?? env.CLAUDE_DAILY_CAP,
    now,
  };
  return createBase({
    resolveViewer: options.resolveViewer ?? janusViewer(auth),
    access,
    organisations: options.organisations ?? organisationDirectory(mongo),
    throttle: options.throttle ?? serverThrottle(),
    trusted: env.TRUSTED_PROXIES,
    proxySecret: options.proxySecret ?? env.PROXY_SECRET,
  })
    .plugin(probes(cataloguesReady))
    .use("/graphql", noStoreMiddleware)
    .plugin((app) => graphql(app, graphqlOptions(deps, options.onUnexpected)))
    .plugin(mediaApp({ mongo, access, now }, media))
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
