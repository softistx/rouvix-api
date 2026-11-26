import type { Migration } from "@softistx/mongo/migrations";
import { accountsErrors } from "./2026-11-25-accounts-errors.migration";
import { initialCatalogues } from "./2026-11-25-initial-catalogues.migration";
import { organisationsErrors } from "./2026-11-25-organisations-errors.migration";
import { slugReserved } from "./2026-11-25-slug-reserved.migration";

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
];
