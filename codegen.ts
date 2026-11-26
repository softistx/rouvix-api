import type { CodegenConfig } from "@graphql-codegen/cli";
import {
  clientCodegenScalars,
  codegenScalars,
} from "@softistx/graphql-scalars";

// `bun run generate` writes, from every src/**/*.graphqls and the SDL of
// @softistx/graphql-scalars and @constraint (generated/graphql/):
// - src/generated/graphql/resolvers.ts: the schema's types and `Resolvers`,
//   whose context is the app's own (`Context`, src/http/context.ts). A module
//   maps a type to the document its model stores with `mappers`.
// - src/generated/graphql/zod.ts: the Zod schemas of the inputs.
// - test/generated/graphql/: `graphql()`, which types each operation written
//   in a test/**/*.spec.ts, its variables and its result.
const schema = ["src/**/*.graphqls", "generated/graphql/**/*.graphqls"];

const config: CodegenConfig = {
  schema,
  ignoreNoDocuments: true,
  generates: {
    "src/generated/graphql/resolvers.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        contextType: "@/http/context#Context",
        scalars: codegenScalars,
        useTypeImports: true,
        useIndexSignature: true,
        // Enums as unions of their values: what the models store.
        enumsAsTypes: true,
        mappers: {
          // The signed-in account's view: the viewer janus authenticated.
          Viewer: "@/auth/access#Viewer as ViewerModel",
          Account: "@/auth/access#Viewer as AccountModel",
          // An organisation and a member, from their documents.
          Organisation: "@/modules/organisations#OrganisationDocument",
          Member: "@/modules/organisations#MemberDocument",
          // The config module's documents.
          Listing: "@/modules/listings#ListingDocument",
          PublicListing: "@/modules/listings#ListingDocument",
          // A page of a search carries its filter, for its chip counts.
          PublicListingConnection: "@/modules/search#SearchPage",
          Country: "@/modules/config#CountryDocument",
          Category: "@/modules/config#CategoryDocument",
          SafePlace: "@/modules/config#SafePlaceDocument",
          // The error catalogue of a language: its version, the messages read
          // when selected; a message as the catalogue holds it.
          ErrorCatalogue: "@/modules/translations#CatalogueView",
          ErrorMessage: "@/modules/translations#ErrorMessageView",
        },
      },
    },
    "src/generated/graphql/zod.ts": {
      plugins: ["@softistx/graphql-codegen-zod"],
      config: { scalarSchemas: "@softistx/graphql-scalars" },
    },
    "test/generated/graphql/": {
      documents: ["test/**/*.spec.ts"],
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        scalars: clientCodegenScalars,
        useTypeImports: true,
        enumsAsTypes: true,
      },
    },
  },
};

export default config;
