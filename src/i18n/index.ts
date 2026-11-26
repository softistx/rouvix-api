import { createI18n } from "@softistx/alxia-i18n";
import { type BuiltInLanguage, setFallbackLanguage } from "@softistx/i18n";
import type { ErrorCode } from "./codes";

// French is the language of a request that names none we speak, and the last
// step of every chain.
export const FALLBACK_LANGUAGE = "fr";
setFallbackLanguage(FALLBACK_LANGUAGE);

// The request's language: `Accept-Language` first, then the `lang` query, then
// the `language` cookie, among fr and en. `i18n.t()` translates in it anywhere
// in the request, an error's message included. The catalogues are the
// database's (`loadCatalogues`, src/modules/translations): until they are
// loaded only the packages' defaults answer, and `t` answers the key.
export const i18n = createI18n<ErrorCode, BuiltInLanguage>({
  languages: ["fr", "en"],
  fallback: FALLBACK_LANGUAGE,
  fallbacks: () => [],
  order: ["header", "query", "cookie"],
});
