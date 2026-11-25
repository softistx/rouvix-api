import { GraphQLError } from "graphql";

// The GraphQLError a promise rejects with; fails the spec if it resolves.
export async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (e: unknown) => e,
  );
  if (!(error instanceof GraphQLError)) throw error;
  return error;
}

// The `fields` of a refused input: `{ path, code }` pairs.
export async function issuesOf(promise: Promise<unknown>) {
  const error = await refusal(promise);
  return (error.extensions["fields"] ?? []) as {
    path: string;
    message: string;
    code: string;
    params?: Record<string, unknown>;
  }[];
}
