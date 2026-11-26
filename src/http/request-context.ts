import type { MediaBucket } from "@softistx/alxia-media";
import type { Mailer } from "@softistx/mail";
import type { Viewer } from "../auth/access";
import type { Auth } from "../auth/auth";
import type { AppMongo } from "../config/db";
import type { Geocoder } from "../geocoder";
import { services } from "../modules";
import type { ListingRanker } from "../modules/search";
import type { Now } from "../shared/dates";
import type { SmsSender } from "../sms";

// What a request's context is built from: everything passed explicitly by
// `createApp`, never defaulted here.
export interface ContextDeps {
  mongo: AppMongo;
  auth: Auth;
  sms: SmsSender;
  mailer: Mailer;
  geocoder: Geocoder;
  media: MediaBucket;
  ranker: ListingRanker;
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
