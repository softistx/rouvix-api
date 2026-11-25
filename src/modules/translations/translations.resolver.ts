import type { Resolvers } from "@/generated/graphql/resolvers";
import { i18n } from "@/i18n";
import { catalogueVersion, errorMessages } from "./translations.load";
import { errorParams } from "./translations.utils";

// The language a `Language` argument names (`FR` is `fr`), or the request's.
const languageOf = (argument: string | null | undefined) =>
  argument?.toLowerCase() ?? i18n.language();

// The error catalogue is public: no guard. It is in memory, read at startup.
export const translationResolvers: Resolvers = {
  Query: {
    errorCatalogue: (_, { language }) => {
      const code = languageOf(language);
      return { language: code, version: catalogueVersion(code) };
    },
    errorCatalogueVersion: (_, { language }) =>
      catalogueVersion(languageOf(language)),
  },
  ErrorCatalogue: {
    language: ({ language }) => (language === "en" ? "EN" : "FR"),
    messages: ({ language }) => errorMessages(language),
  },
  ErrorMessage: {
    params: ({ message }) => errorParams(message),
  },
};
