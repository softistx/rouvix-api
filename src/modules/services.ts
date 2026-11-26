import type { Mailer } from "@softistx/mail";
import type { Viewer } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import type { AppMongo } from "@/config/db";
import type { Geocoder } from "@/geocoder";
import type { Now } from "@/shared/dates";
import type { SmsSender } from "@/sms";
import { AccountsService } from "./accounts";
import {
  CategoriesService,
  CountriesService,
  GeocodingService,
  SafePlacesService,
} from "./config";
import {
  MembersService,
  OrganisationRelations,
  OrganisationsService,
} from "./organisations";

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
}

// The services of one request, wired to each other and to their ports.
// Nothing built here outlives the request.
export function services(deps: ServiceDeps & { viewer: Viewer | null }) {
  const { viewer, ...rest } = deps;
  const mongo = viewer ? rest.mongo.as(viewer.id) : rest.mongo;
  const relations = new OrganisationRelations(rest.auth);
  const countries = new CountriesService(mongo);
  return {
    countries,
    categories: new CategoriesService(mongo),
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
