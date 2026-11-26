import type { MediaBucket } from "@softistx/alxia-media";
import type { Mailer } from "@softistx/mail";
import type { Viewer } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import type { AppMongo } from "@/config/db";
import type { Geocoder } from "@/geocoder";
import type { Background } from "@/shared/background";
import type { Now } from "@/shared/dates";
import type { SmsSender } from "@/sms";
import { AccountsService } from "./accounts";
import {
  CategoriesService,
  CountriesService,
  GeocodingService,
  SafePlacesService,
} from "./config";
import { ListingsService, PhotosService } from "./listings";
import {
  MembersService,
  OrganisationRelations,
  OrganisationsService,
} from "./organisations";
import { type ListingRanker, MapService, SearchService } from "./search";

export interface ServiceDeps {
  // The database, as the request's viewer writes it (stamped as the actor).
  mongo: AppMongo;
  auth: Pick<Auth, "accounts" | "permissions">;
  now: Now;
  // The two ports the sign-in will use, passed explicitly and never
  // defaulted: the SMS provider and the mailer.
  sms: SmsSender;
  mailer: Mailer;
  // The geocoding provider, passed explicitly and never defaulted.
  geocoder: Geocoder;
  // The private bucket the photos live in, and where the photo job runs from.
  media: MediaBucket;
  background: Pick<Background, "run">;
  // How a text search puts its matches in order, passed explicitly.
  ranker: ListingRanker;
}

// The services of one request, wired to each other and to their ports.
// Nothing built here outlives the request.
export function services(deps: ServiceDeps & { viewer: Viewer | null }) {
  const { viewer, ...rest } = deps;
  const mongo = viewer ? rest.mongo.as(viewer.id) : rest.mongo;
  const relations = new OrganisationRelations(rest.auth);
  const countries = new CountriesService(mongo);
  const categories = new CategoriesService(mongo);
  const photos = new PhotosService(mongo, rest.media);
  return {
    countries,
    categories,
    photos,
    listings: new ListingsService(mongo, {
      countries,
      categories,
      photos,
      now: rest.now,
      background: rest.background,
    }),
    search: new SearchService(mongo, { now: rest.now, ranker: rest.ranker }),
    map: new MapService(mongo, { now: rest.now }),
    safePlaces: new SafePlacesService(mongo, countries),
    geocoding: new GeocodingService(rest.geocoder),
    accounts: new AccountsService(rest.auth, {
      sms: rest.sms,
      mailer: rest.mailer,
    }),
    organisations: new OrganisationsService(mongo, rest.auth, relations),
    members: new MembersService(mongo, relations, rest.now),
  };
}

export type Services = ReturnType<typeof services>;
