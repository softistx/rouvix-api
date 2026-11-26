import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DataError, OptimisticLockError } from "@softistx/mongo";
import { fail } from "./errors";
import {
  BEATEN_ATTEMPTS,
  backoff,
  CONFLICT_ATTEMPTS,
  locked,
  retryWriteConflicts,
  writeConflict,
} from "./locked";

const stale = () => fail("organisations.errors.stale-version", { status: 409 });
const original = backoff.ms;
const pauses: number[] = [];

beforeEach(() => {
  pauses.length = 0;
  backoff.ms = (attempt) => {
    pauses.push(attempt);
    return 0;
  };
});
afterEach(() => {
  backoff.ms = original;
});

describe("locked", () => {
  test("a DataError labelled TransientTransactionError is retried like a write conflict", async () => {
    let calls = 0;
    const result = await locked(
      false,
      async () => {
        if (++calls < 3) {
          throw new DataError("Transient", {
            cause: { errorLabels: ["TransientTransactionError"] },
          });
        }
        return "done";
      },
      { stale },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
    expect(pauses).toEqual([1, 2]);
  });

  test("a write conflict runs the write again after a pause", async () => {
    let calls = 0;
    const result = await locked(
      false,
      async () => {
        if (++calls < 3) throw writeConflict();
        return "done";
      },
      { stale },
    );
    expect(result).toBe("done");
    expect(pauses).toEqual([1, 2]);
  });

  test("a write that keeps losing is the stale refusal after the conflict attempts", async () => {
    let calls = 0;
    const error = await locked(
      false,
      async () => {
        calls++;
        throw writeConflict();
      },
      { stale },
    ).catch((e: unknown) => e);
    expect(calls).toBe(CONFLICT_ATTEMPTS);
    expect((error as ReturnType<typeof stale>).extensions["code"]).toBe(
      "organisations.errors.stale-version",
    );
  });

  test("a lost version with a client version is refused at once", async () => {
    let calls = 0;
    await locked(
      true,
      async () => {
        calls++;
        throw new OptimisticLockError();
      },
      { stale },
    ).catch(() => undefined);
    expect(calls).toBe(1);
    expect(pauses).toEqual([]);
  });

  test("another error passes through", async () => {
    const boom = new DataError("boom", { serverCode: 1 });
    expect(
      await locked(false, async () => Promise.reject(boom), { stale }).catch(
        (e: unknown) => e,
      ),
    ).toBe(boom);
  });
});

describe("retryWriteConflicts", () => {
  class Exhausted extends Error {}

  test("a write conflict runs the write again after a pause", async () => {
    let calls = 0;
    const result = await retryWriteConflicts(
      async () => {
        if (++calls < 3) throw writeConflict();
        return "done";
      },
      () => new Exhausted(),
    );
    expect(result).toBe("done");
    expect(pauses).toEqual([1, 2]);
  });

  test("eight conflict attempts, then the error it is given", async () => {
    let calls = 0;
    const error = await retryWriteConflicts(
      async () => {
        calls++;
        throw writeConflict();
      },
      () => new Exhausted(),
    ).catch((e: unknown) => e);
    expect(CONFLICT_ATTEMPTS).toBe(8);
    expect(calls).toBe(CONFLICT_ATTEMPTS);
    expect(error).toBeInstanceOf(Exhausted);
    expect(pauses).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("the pause is uniform in [d/2, d], d = min(500, 25 * 2^n)", () => {
    backoff.ms = original;
    const ceilings = [50, 100, 200, 400, 500, 500, 500];
    ceilings.forEach((d, i) => {
      for (const random of [0, 0.5, 0.999]) {
        const real = Math.random;
        Math.random = () => random;
        const ms = backoff.ms(i + 1);
        Math.random = real;
        expect(ms).toBeGreaterThanOrEqual(d / 2);
        expect(ms).toBeLessThanOrEqual(d);
      }
    });
    expect(ceilings.reduce((a, b) => a + b, 0) * 0.75).toBeLessThan(1750);
    expect(backoff.ms(20)).toBeLessThanOrEqual(500);
  });

  test("beaten errors get 3 attempts and no pause", async () => {
    let calls = 0;
    const error = await retryWriteConflicts(
      async () => {
        calls++;
        throw new OptimisticLockError();
      },
      () => new Exhausted(),
      { beaten: (e) => e instanceof OptimisticLockError },
    ).catch((e: unknown) => e);
    expect(BEATEN_ATTEMPTS).toBe(3);
    expect(calls).toBe(BEATEN_ATTEMPTS);
    expect(error).toBeInstanceOf(Exhausted);
    expect(pauses).toEqual([]);
  });

  test("beatenIsFinal ends at the first beaten error", async () => {
    let calls = 0;
    await retryWriteConflicts(
      async () => {
        calls++;
        throw new OptimisticLockError();
      },
      () => new Exhausted(),
      { beaten: () => true, beatenIsFinal: true },
    ).catch(() => undefined);
    expect(calls).toBe(1);
  });

  test("conflicts and beaten errors are counted apart", async () => {
    let calls = 0;
    const result = await retryWriteConflicts(
      async () => {
        calls++;
        if (calls <= CONFLICT_ATTEMPTS - 1) throw writeConflict();
        if (calls <= CONFLICT_ATTEMPTS + BEATEN_ATTEMPTS - 2) {
          throw new OptimisticLockError();
        }
        return "done";
      },
      () => new Exhausted(),
      { beaten: (e) => e instanceof OptimisticLockError },
    );
    expect(result).toBe("done");
    expect(calls).toBe(CONFLICT_ATTEMPTS + BEATEN_ATTEMPTS - 1);
  });

  test("another error passes through at once", async () => {
    const boom = new Error("boom");
    let calls = 0;
    const error = await retryWriteConflicts(
      async () => {
        calls++;
        throw boom;
      },
      () => new Exhausted(),
    ).catch((e: unknown) => e);
    expect(error).toBe(boom);
    expect(calls).toBe(1);
  });
});
