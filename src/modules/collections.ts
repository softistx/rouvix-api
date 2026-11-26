// Every collection of the app, under the key the Mongo exposes it by
// (`mongo.db.organisations`): src/config/db.ts wires this module object. A
// module adds its models here. Biome sorts the exports by path, so no block is
// grouped by position. The global collection (no `organisationId`; AGENTS.md,
// Tenancy) is translations' `translations`: migrations write it, the startup
// load reads it, a request never does. `organisations` is the tenant itself;
// every other collection is organisation-owned unless it says it belongs to
// the platform (janus keeps its own, src/config/janus-sync.ts).

export { members, organisations } from "./organisations/models";
export { translations } from "./translations/translations.model";
