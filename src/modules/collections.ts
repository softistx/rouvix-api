// Every collection of the app, under the key the Mongo exposes it by
// (`mongo.db.organisations`): src/config/db.ts wires this module object. A
// module adds its models here. Biome sorts the exports by path, so no block is
// grouped by position. The global collections (no `organisationId`; AGENTS.md,
// Tenancy) are translations' `translations`, which migrations write, the startup
// load reads and a request never does, and config's `countries`, `categories`
// and `safePlaces`: platform data, seeded by migrations, read by every request
// and edited by the platform admin. `organisations` is the tenant itself; every
// other collection is organisation-owned (janus keeps its own,
// src/config/janus-sync.ts).

export { categories, countries, safePlaces } from "./config/models";
export { members, organisations } from "./organisations/models";
export { translations } from "./translations/translations.model";
