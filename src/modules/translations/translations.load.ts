import {
  type BuiltInLanguage,
  type Catalogue,
  mergeCatalogues,
  registerCatalogue,
  resources,
} from "@softistx/i18n";
import { migrate } from "@softistx/mongo/migrations";
import type { AppMongo } from "@/config/db";
import { FALLBACK_LANGUAGE, i18n } from "@/i18n";
import { errorCodes } from "@/i18n/codes";
import { migrations } from "@/migrations";
import { assertMigrated } from "@/migrations/status";
import {
  catalogueOf,
  type ErrorMessageView,
  messagesOf,
  versionOf,
} from "./translations.utils";

// The languages the API speaks: French, the fallback, and English.
export const LANGUAGES = ["fr", "en"] as const;

let loaded = false;

// What the API serves of each language, built by `loadCatalogues`: its merged
// catalogue and the version of its chain (itself, then French).
const served = new Map<string, { chain: Catalogue[]; version: string }>();

// The version of the error catalogue a language serves, "" for a language that
// is not shipped. In memory: asking for it reads nothing.
export const catalogueVersion = (language: string): string =>
  served.get(language)?.version ?? "";

// Every error code's message in a language, each missing one filled from
// French: the `errorCatalogue` list, computed when it is selected.
export const errorMessages = (language: string): ErrorMessageView[] =>
  messagesOf(served.get(language)?.chain ?? [], errorCodes);

// Whether `loadCatalogues` has run: what `/ready` waits for.
export const cataloguesLoaded = () => loaded;

// The catalogues the API speaks, read at startup from the global
// `translations` collection (with the migrations, its only reader and writer,
// unscoped; a request reads the in-memory catalogues only):
//  1. refuses a database with a pending migration (`MigrationsOutOfSyncError`);
//  2. reads the live translations;
//  3. per language, layers the @softistx/i18n defaults under the translations;
//  4. gives them to @softistx/alxia-i18n (`setResources`, atomic: a request in
//     flight keeps its snapshot) and registers them with @softistx/i18n, for
//     the packages that translate through it;
//  5. keeps what `errorCatalogue` serves per language (the chain and its
//     version, a digest of the merged texts).
export async function loadCatalogues(
  mongo: AppMongo,
  list: typeof migrations = migrations,
): Promise<void> {
  await assertMigrated(mongo.db, list);
  const rows = await mongo.db.translations.raw.find({}).toArray();
  const catalogues: Record<string, Catalogue> = {};
  for (const language of LANGUAGES) {
    catalogues[language] = mergeCatalogues(
      (resources as Record<string, Catalogue>)[language] ?? {},
      catalogueOf(rows, language),
    );
    registerCatalogue(language, catalogues[language], { replace: true });
  }
  i18n.setResources(catalogues as Record<BuiltInLanguage, Catalogue>);
  const last = catalogues[FALLBACK_LANGUAGE] as Catalogue;
  served.clear();
  for (const language of LANGUAGES) {
    const own = catalogues[language] as Catalogue;
    const chain = language === FALLBACK_LANGUAGE ? [own] : [own, last];
    served.set(language, { chain, version: versionOf(chain) });
  }
  loaded = true;
}

// What the server does before it listens: in development (`autoMigrate`) it
// applies the pending migrations itself, as it syncs janus's collections;
// anywhere else a pending migration stops it (`MigrationsOutOfSyncError`),
// since `bun run db:migrate` is a deployment step, not something every
// instance races to do at boot.
export async function bootCatalogues(
  mongo: AppMongo,
  options: { autoMigrate: boolean; list?: typeof migrations },
): Promise<void> {
  const list = options.list ?? migrations;
  if (options.autoMigrate) await migrate(mongo.db, list);
  await loadCatalogues(mongo, list);
}
