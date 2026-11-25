import { join } from "node:path";
import { loadFilesSync } from "@graphql-tools/load-files";
import { mergeTypeDefs } from "@graphql-tools/merge";
import { scalarResolvers, scalarTypeDefs } from "@softistx/graphql-scalars";
import {
  constraintTypeDefs,
  withValidation,
} from "@softistx/graphql-validation";
import { createSchema } from "@softistx/graxia";
import { resolvers } from "../modules";
import type { Context } from "./context";
import { sdlRoot } from "./sdl-root";

// Every src/**/*.graphqls, one per module, merged into one schema: each may
// declare its own `type Query` or `extend type Query`. Read at startup from
// src/, beside dist/ in the image.
const root = sdlRoot(import.meta.dir);
const typeDefs = mergeTypeDefs([
  scalarTypeDefs,
  constraintTypeDefs,
  ...loadFilesSync(join(root, "src"), { extensions: ["graphqls"] }),
]);

export const schema = withValidation(
  createSchema<Context>()({
    typeDefs,
    incremental: false,
    resolvers: [scalarResolvers, ...resolvers],
  }),
);
