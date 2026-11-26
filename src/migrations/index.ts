import type { Migration } from "@softistx/mongo/migrations";
import { accountsErrors } from "./2026-11-25-accounts-errors.migration";
import { initialCatalogues } from "./2026-11-25-initial-catalogues.migration";
import { organisationsErrors } from "./2026-11-25-organisations-errors.migration";
import { slugReserved } from "./2026-11-25-slug-reserved.migration";
import { categoriesSeed } from "./2026-11-26-categories.migration";
import { configErrors } from "./2026-11-26-config-errors.migration";
import { countriesSeed } from "./2026-11-26-countries.migration";
import { safePlacesSeed } from "./2026-11-26-safe-places.migration";
import { listingsErrors } from "./2026-11-27-listings-errors.migration";
import { listingsSearch } from "./2026-11-28-listings-search.migration";
import { throttleErrors } from "./2026-11-28-throttle-errors.migration";
import { aiErrors } from "./2026-11-29-ai-errors.migration";
import { listingsIdFields } from "./2026-11-29-listings-id-fields.migration";
import { aiObjectsErrors } from "./2026-11-30-ai-objects-errors.migration";
import { notificationsErrors } from "./2026-12-01-notifications-errors.migration";

// The migrations `bun run db:migrate` applies, in EXECUTION order: the only
// thing `migrate`, `rollback` and the boot check read. A new migration is
// appended at the end; none is removed or reordered. An id is
// `YYYY-MM-DD-<slug>` and permanent: a name, not a sort key. One merged into
// `develop` never changes: a fix is a new migration. A migration imports
// nothing from `src/modules/` (models evolve); it imports its JSON,
// `mongodb` types and `kit/`.
export const migrations: readonly Migration[] = [
  initialCatalogues,
  accountsErrors,
  organisationsErrors,
  slugReserved,
  categoriesSeed,
  countriesSeed,
  safePlacesSeed,
  configErrors,
  listingsErrors,
  throttleErrors,
  listingsSearch,
  aiErrors,
  listingsIdFields,
  aiObjectsErrors,
  notificationsErrors,
];
