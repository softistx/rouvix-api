import type { Resolvers } from "@/generated/graphql/resolvers";
import { i18n } from "@/i18n";
import { catalogueVersion, errorMessages } from "./translations.load";
import { errorParams, languageOf } from "./translations.utils";

// The error catalogue is public: no guard. It is in memory, read at startup.
export const translationResolvers: Resolvers = {
  Query: {
    errorCatalogue: (_, { language }) => {
      const code = languageOf(language, i18n.language());
      return { language: code, version: catalogueVersion(code) };
    },
    errorCatalogueVersion: (_, { language }) =>
      catalogueVersion(languageOf(language, i18n.language())),
  },
  ErrorCatalogue: {
    language: ({ language }) => (language === "en" ? "EN" : "FR"),
    messages: ({ language }) => errorMessages(language),
  },
  ErrorMessage: {
    params: ({ message }) => errorParams(message),
  },
};
