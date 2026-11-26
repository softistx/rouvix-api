import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { clearDatabase } from "~/db";
import { UsageService } from "./usage.service";

let clock: Date;
beforeEach(async () => {
  await clearDatabase();
  clock = new Date("2026-12-01T10:00:00Z");
});

const usage = (dailyCap: number) =>
  new UsageService(mongo, { now: () => clock, dailyCap });

describe("the day's use of Claude", () => {
  test("counts calls up to the cap and refuses past it", async () => {
    const service = usage(2);
    expect(await service.claim()).toBe(true);
    expect(await service.claim()).toBe(true);
    expect(await service.claim()).toBe(false);
    expect((await service.today()).calls).toBe(2);
  });

  test("a cap of 0 refuses every call", async () => {
    expect(await usage(0).claim()).toBe(false);
  });

  test("concurrent calls cannot pass the cap together", async () => {
    const service = usage(3);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.claim()),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await service.today()).calls).toBe(3);
  });

  test("a new UTC day starts at zero", async () => {
    const service = usage(1);
    await service.claim();
    expect(await service.claim()).toBe(false);
    clock = new Date("2026-12-02T00:00:01Z");
    expect(await service.claim()).toBe(true);
  });

  test("adds the tokens of the calls that answered", async () => {
    const service = usage(5);
    await service.claim();
    await service.record({ inputTokens: 1000, outputTokens: 80 });
    await service.claim();
    await service.record({ inputTokens: 500, outputTokens: 20 });
    expect(await service.today()).toEqual({
      calls: 2,
      inputTokens: 1500,
      outputTokens: 100,
    });
  });
});
