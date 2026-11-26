import type { MediaBucket } from "@softistx/alxia-media";
import type { Mailer } from "@softistx/mail";
import type { Viewer } from "../auth/access";
import type { Auth } from "../auth/auth";
import type { AppMongo } from "../config/db";
import type { ObjectDescriber } from "../describer";
import type { Embedder } from "../embedder";
import type { Geocoder } from "../geocoder";
import { services } from "../modules";
import type { ListingRanker } from "../modules/search";
import type { Ocr } from "../ocr";
import type { ImageRedactor } from "../redactor";
import type { Now } from "../shared/dates";
import type { SmsSender } from "../sms";
import type { IdVault } from "../vault";

// What a request's context is built from: everything passed explicitly by
// `createApp`, never defaulted here.
export interface ContextDeps {
  mongo: AppMongo;
  auth: Auth;
  sms: SmsSender;
  mailer: Mailer;
  geocoder: Geocoder;
  media: MediaBucket;
  ocr: Ocr;
  redactor: ImageRedactor;
  vault: IdVault;
  ranker: ListingRanker;
  describer: ObjectDescriber;
  embedder: Embedder;
  claudeDailyCap: number;
  now: Now;
}

// The per-request part of the resolvers' context: the services, bound to the
// request's viewer (who stamps its writes).
export function requestContext(deps: ContextDeps) {
  return ({
    serverContext: { viewer },
  }: {
    serverContext: { viewer: Viewer | null };
  }) => ({
    services: services({ ...deps, background: deps.auth.background, viewer }),
  });
}
