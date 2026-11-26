import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { clearDatabase, resetConfig } from "~/db";
import { issuesOf } from "~/refusals";
import { CountriesService, type CountryInput } from "./countries.service";

const service = new CountriesService(mongo);
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
});

const input = (over: Partial<CountryInput> = {}): CountryInput => ({
  code: "GA",
  names: { fr: "Gabon", en: "Gabon" },
  dialCode: "+241",
  phonePattern: "^\\+241\\d{8}$",
  documentTypes: ["CNI", "PASSPORT"],
  languages: ["FR"],
  mapCenter: { latitude: -0.8, longitude: 11.6 },
  mapZoom: 6,
  idNumberPatterns: [{ documentType: "CNI", pattern: "^\\d{8}$" }],
  ...over,
});

describe("the seed", () => {
  test("Cameroon is there, with its prefix, document types, patterns and map centre", async () => {
    const cameroon = await service.find("CM");
    expect(cameroon).toMatchObject({
      names: { fr: "Cameroun", en: "Cameroon" },
      dialCode: "+237",
      languages: ["FR", "EN"],
      active: true,
    });
    expect(cameroon?.documentTypes).toContain("CNI");
    expect(cameroon?.mapCenter.latitude).toBeGreaterThan(0);
    expect(cameroon?.idNumberPatterns.length).toBeGreaterThan(0);
    for (const { documentType, pattern } of cameroon?.idNumberPatterns ?? []) {
      expect(cameroon?.documentTypes).toContain(documentType);
      expect(() => new RegExp(pattern)).not.toThrow();
    }
  });

  test("its phone pattern accepts a fake Cameroon number and refuses a foreign one", async () => {
    const pattern = new RegExp((await service.find("CM"))?.phonePattern ?? "");
    expect(pattern.test("+237600000001")).toBe(true);
    expect(pattern.test("+33600000001")).toBe(false);
    expect(pattern.test("+23760000")).toBe(false);
  });
});

describe("set", () => {
  test("adds a country, then replaces it, stamping the actor", async () => {
    const made = await service.set(input());
    expect(made).toMatchObject({ _id: "GA", active: true, version: 0 });
    const again = await service.set(
      input({ names: { fr: "Gabon", en: "Gabon!" }, active: false }),
    );
    expect(again).toMatchObject({ names: { en: "Gabon!" }, active: false });
    expect(again.version).toBeGreaterThan(made.version);
    expect(await mongo.db.countries.count({})).toBe(2);
  });

  test("two sets of one new code at once leave one country", async () => {
    await Promise.all([
      service.set(input()),
      service.set(input({ mapZoom: 7 })),
    ]);
    expect(await mongo.db.countries.count({ _id: "GA" })).toBe(1);
  });

  test("a bad pattern or an unknown document type is one invalid-input with each issue", async () => {
    const issues = await issuesOf(
      service.set(
        input({
          phonePattern: "(",
          documentTypes: ["CNI", "NOPE"],
          idNumberPatterns: [],
        }),
      ),
    );
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      "phonePattern:validation.errors.invalid-format",
      "documentTypes.1:config.errors.document-type-unknown",
    ]);
    expect(await service.find("GA")).toBeUndefined();
  });

  test("a document type of an inactive category is refused", async () => {
    await mongo.db.categories.update("PASSPORT", { active: false });
    const issues = await issuesOf(service.set(input()));
    expect(issues.map((i) => i.path)).toEqual(["documentTypes.1"]);
  });
});

describe("list and active", () => {
  test("an inactive country is out of the public list and not active", async () => {
    await service.set(input({ active: false }));
    expect((await service.list(false)).map((c) => c._id)).toEqual(["CM"]);
    expect((await service.list(true)).map((c) => c._id)).toEqual(["CM", "GA"]);
    expect(await service.active("GA")).toBeUndefined();
    expect((await service.active("CM"))?._id).toBe("CM");
  });
});
