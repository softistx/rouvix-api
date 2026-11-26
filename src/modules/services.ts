import type { MediaBucket } from "@softistx/alxia-media";
import type { Mailer } from "@softistx/mail";
import type { Viewer } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import type { AppMongo } from "@/config/db";
import type { ObjectDescriber } from "@/describer";
import type { Embedder } from "@/embedder";
import type { Geocoder } from "@/geocoder";
import type { Ocr } from "@/ocr";
import type { PushSender } from "@/push";
import type { ImageRedactor } from "@/redactor";
import type { Background } from "@/shared/background";
import type { Now } from "@/shared/dates";
import type { SmsSender } from "@/sms";
import type { IdVault } from "@/vault";
import { AccountsService } from "./accounts";
import {
  EmbeddingsService,
  RemotePhotoGuard,
  SuggestionsService,
  UsageService,
} from "./ai";
import {
  CategoriesService,
  CountriesService,
  GeocodingService,
  SafePlacesService,
} from "./config";
import {
  IdDocumentsService,
  ListingEmbeddings,
  ListingsService,
  PhotosService,
} from "./listings";
import {
  NoticesService,
  NotifyService,
  PushSubscriptions,
  SettingsService,
} from "./notifications";
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
  // The ID document pipeline's three, local all (spec §4.2): the OCR sidecar,
  // the in-process blur and the vault of the ID fields.
  ocr: Ocr;
  redactor: ImageRedactor;
  vault: IdVault;
  background: Pick<Background, "run">;
  // The AI ports, passed explicitly: Claude's object describer (spec §4.3,
  // reached through the remote photo guard only) and the local embedder, and
  // the day's cap of Claude calls (spec §5.5).
  describer: ObjectDescriber;
  embedder: Embedder;
  claudeDailyCap: number;
  // How a text search puts its matches in order, passed explicitly.
  ranker: ListingRanker;
  // Web Push (spec §5.6), passed explicitly, and what an e-mail copy needs: the
  // address mails leave from and the UI's base URL its links start with.
  push: PushSender;
  mail: { from: string; uiUrl: string };
}

// The services of one request, wired to each other and to their ports.
// Nothing built here outlives the request.
export function services(deps: ServiceDeps & { viewer: Viewer | null }) {
  const { viewer, ...rest } = deps;
  const mongo = viewer ? rest.mongo.as(viewer.id) : rest.mongo;
  const relations = new OrganisationRelations(rest.auth);
  const countries = new CountriesService(mongo);
  const categories = new CategoriesService(mongo);
  const pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const documents = new IdDocumentsService({
    bucket: rest.media,
    ocr: rest.ocr,
    redactor: rest.redactor,
    vault: rest.vault,
    countries,
    now: rest.now,
    pause,
  });
  const photos = new PhotosService(mongo, rest.media, documents, pause);
  // The embedding job runs after a listing's photo job (listings.service.ts),
  // and reads the listing it embeds: the closure is called after both exist.
  const indexing = { index: (id: string) => embeddings.index(id) };
  const listings = new ListingsService(mongo, {
    countries,
    categories,
    photos,
    now: rest.now,
    background: rest.background,
    indexing,
  });
  const embeddings = new EmbeddingsService({
    embedder: rest.embedder,
    listings,
    vectors: new ListingEmbeddings(mongo),
    pause,
  });
  const remotePhotos = new RemotePhotoGuard({
    ocr: rest.ocr,
    categories,
    countries,
    idPhoto: (key) => listings.isIdPhoto(key),
    now: rest.now,
  });
  const notices = new NoticesService(mongo, rest.now);
  const settings = new SettingsService(mongo, rest.auth);
  const subscriptions = new PushSubscriptions(mongo, rest.push.available);
  return {
    notices,
    settings,
    subscriptions,
    // The one door the later slices call to tell an account something.
    notifier: new NotifyService({
      auth: rest.auth,
      notices,
      settings,
      subscriptions,
      push: rest.push,
      mailer: rest.mailer,
      background: rest.background,
      listing: (id) => listings.find(id.toHexString()),
      mail: rest.mail,
    }),
    countries,
    categories,
    photos,
    listings,
    // The gate of every call that would send a photo off the VPS: an ID
    // document's never passes, and the object describer is behind it.
    remotePhotos,
    suggestions: new SuggestionsService({
      guard: remotePhotos,
      describer: rest.describer,
      usage: new UsageService(mongo, {
        now: rest.now,
        dailyCap: rest.claudeDailyCap,
      }),
      photos,
      categories,
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
