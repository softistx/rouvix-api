import { DataError, OptimisticLockError } from "@softistx/mongo";
import type { GraphQLError } from "graphql";

// MongoDB's WriteConflict: two transactions wrote the same document.
const WRITE_CONFLICT = 112;

// With `retryTransient: false` (`src/config/db.ts`) the driver reruns nothing,
// so the first transient error comes back as it is, a commit-time one too (the
// driver used to retry those itself): a DataError labelled
// TransientTransactionError counts as a write conflict, like code 112.
export const isWriteConflict = (error: unknown) =>
  error instanceof DataError &&
  (error.serverCode === WRITE_CONFLICT ||
    error.hasErrorLabel("TransientTransactionError"));

// A WriteConflict that a unique index caused, as the server reports it: the
// same retry as any other write conflict.
export const writeConflict = (cause?: unknown) =>
  new DataError("Write conflict", {
    serverCode: WRITE_CONFLICT,
    ...(cause === undefined ? {} : { cause }),
  });

// A write conflict is retried up to 8 attempts in all, for about 2 s: the
// writers contending on the organisation's document wait for the winner (as the
// driver's own retry let them on @softistx/mongo 0.20) before the 409.
export const CONFLICT_ATTEMPTS = 8;
// A beaten error (a lost version, a lost unique index) is retried at once,
// 3 attempts in all. The two are counted apart.
export const BEATEN_ATTEMPTS = 3;

// The pause before the attempt that follows the n-th write conflict, in
// milliseconds: uniform in [d/2, d] with d = min(500, 25 * 2^n), so 50, 100,
// 200, 400, then 500 at most: about 1.7 s in all on average, 2.25 s at most,
// jittered so that the writers that collided do not collide again. A spec that
// counts attempts replaces it (`backoff.ms = () => 0`).
export const backoff = {
  ms: (attempt: number) => {
    const d = Math.min(500, 25 * 2 ** attempt);
    return d / 2 + Math.random() * (d / 2);
  },
};

type ErrorClass = abstract new (...args: never[]) => Error;

export interface RetryOptions {
  // Errors that mean "someone wrote first" without being a write conflict: they
  // are retried at once, with no pause.
  beaten?: (error: unknown) => boolean;
  // A beaten error ends the retries at once (the client named the version).
  beatenIsFinal?: boolean;
}

// Runs a write again when a concurrent one beat it: a WriteConflict (up to
// CONFLICT_ATTEMPTS attempts, with the `backoff` pause between them), or what
// `options.beaten` names (BEATEN_ATTEMPTS attempts, no pause). The two are
// counted apart, then `exhausted()` is thrown. Any other error passes
// through. `locked` and the operator's texts both build on it.
export async function retryWriteConflicts<T>(
  write: () => Promise<T>,
  exhausted: () => Error,
  { beaten = () => false, beatenIsFinal = false }: RetryOptions = {},
): Promise<T> {
  let conflicts = 0;
  let losses = 0;
  for (;;) {
    try {
      return await write();
    } catch (error) {
      if (beaten(error)) {
        if (beatenIsFinal || ++losses >= BEATEN_ATTEMPTS) throw exhausted();
      } else if (isWriteConflict(error)) {
        if (++conflicts >= CONFLICT_ATTEMPTS) throw exhausted();
        await new Promise((resolve) =>
          setTimeout(resolve, backoff.ms(conflicts)),
        );
      } else throw error;
    }
  }
}

export interface LockOptions {
  // The module's `stale-version` refusal, thrown when the write lost for
  // good. A write that throws it itself (a client's `version` that is not
  // the one read) counts as having lost.
  stale: () => GraphQLError;
  // Other errors that mean "someone wrote first", beside the version lock's
  // OptimisticLockError: a unique index a first write lost, for instance.
  lost?: readonly ErrorClass[];
}

// A write that locks on the version it read, or serialises on a document.
// A write conflict between transactions is retried CONFLICT_ATTEMPTS times
// with the capped `backoff` pause, even when the client named a version. A
// beaten error (a stale OptimisticLockError, or one of `options.lost`) is
// retried BEATEN_ATTEMPTS times, `write` reading again so that two updates of
// different fields both land; when the client named the version, the first is
// final and is the 409 `options.stale` (AGENTS.md, "Updates").
export function locked<T>(
  versionGiven: boolean,
  write: () => Promise<T>,
  { stale, lost = [] }: LockOptions,
): Promise<T> {
  const code = stale().extensions["code"];
  return retryWriteConflicts(write, stale, {
    beatenIsFinal: versionGiven,
    beaten: (error) =>
      error instanceof OptimisticLockError ||
      lost.some((type) => error instanceof type) ||
      (error instanceof Error &&
        (error as GraphQLError).extensions?.["code"] === code),
  });
}
