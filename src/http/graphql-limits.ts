// What /graphql may cost before any auth, given to `graphql()` (src/app.ts).
// The operation limits are generous for a skeleton and meant to be tightened
// from what rouvix-ui sends once its operations exist (never under graxia's
// defaults of depth 12, 30 aliases, 50 directives, 20 root fields, 5 000 tokens).
export const MAX_DEPTH = 16;
export const MAX_ALIASES = 30;
export const MAX_DIRECTIVES = 50;
export const MAX_ROOT_FIELDS = 20;
export const MAX_COST = 14_000;
export const BODY_LIMIT = 128 * 1024;
export const MAX_TOKENS = 2000;
export const PARSE_CACHE_MAX = 64;
