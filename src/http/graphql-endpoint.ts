import type { UnexpectedInfo } from "@softistx/graxia";
import { StoreFailure } from "@softistx/janus";
import { GraphQLError } from "graphql";
import { unavailable } from "../shared/errors";
import { apiErrors } from "./api-errors";
import { clientHeader, requireClientHeader } from "./csrf";
import {
  BODY_LIMIT,
  MAX_ALIASES,
  MAX_COST,
  MAX_DEPTH,
  MAX_DIRECTIVES,
  MAX_ROOT_FIELDS,
  MAX_TOKENS,
  PARSE_CACHE_MAX,
} from "./graphql-limits";
import { noStore } from "./no-store";
import { type ContextDeps, requestContext } from "./request-context";
import { schema } from "./schema";

export type ReportUnexpected = (
  error: unknown,
  info: { correlationId?: string | undefined; phase: string },
) => void;

export const logUnexpected: ReportUnexpected = (error, info) => {
  console.error(`unexpected ${info.phase} ${info.correlationId ?? "-"}`, error);
};

// An unexpected error as the client sees it (graxia calls this for the errors
// it masks only): no message, a correlation id to quote. A janus store that
// cannot answer is the 503 `auth.errors.unavailable`, never a bare 500.
export function maskError(
  error: GraphQLError,
  info: { correlationId: string | undefined },
): GraphQLError {
  if (error.originalError instanceof StoreFailure) return unavailable();
  return new GraphQLError("Unexpected error.", {
    nodes: error.nodes ?? null,
    source: error.source ?? null,
    positions: error.positions ?? null,
    path: error.path ?? null,
    extensions: {
      code: "INTERNAL_SERVER_ERROR",
      ...(info.correlationId === undefined
        ? {}
        : { correlationId: info.correlationId }),
      fix: "Retry later; quote the correlationId when you report it.",
    },
  });
}

export function graphqlOptions(
  deps: ContextDeps,
  report: ReportUnexpected = logUnexpected,
) {
  return {
    schema,
    context: requestContext(deps),
    maskError,
    onUnexpected: (error: unknown, info: UnexpectedInfo) => report(error, info),
    plugins: [noStore, requireClientHeader, apiErrors],
    bodyLimit: BODY_LIMIT,
    limits: {
      tokens: MAX_TOKENS,
      depth: MAX_DEPTH,
      aliases: MAX_ALIASES,
      directives: MAX_DIRECTIVES,
      rootFields: MAX_ROOT_FIELDS,
      cost: { max: MAX_COST },
    } as const,
    caches: {
      parse: { max: PARSE_CACHE_MAX },
      validation: { max: PARSE_CACHE_MAX },
    },
    csrf: { requireHeader: false },
    ide: "apollo-sandbox" as const,
    sandbox: { initialHeaders: { [clientHeader]: "apollo-sandbox" } },
  };
}
