import { beforeEach, describe, expect, test } from "bun:test";
import { mongo } from "@/config/db";
import { clearDatabase, resetConfig } from "~/db";
import { issuesOf } from "~/refusals";
import { CategoriesService, type CategoryInput } from "./categories.service";

const service = new CategoriesService(mongo);
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
});

const input = (over: Partial<CategoryInput> = {}): CategoryInput => ({
  key: "BICYCLE",
  labels: { fr: "Vélos", en: "Bicycles" },
  parent: null,
  isDocument: false,
  order: 20,
  ...over,
});

describe("the seed", () => {
  test("lists documents first, each root followed by its children", async () => {
    const tree = await service.list(false);
    expect(tree[0]).toMatchObject({ _id: "DOCUMENT", isDocument: true });
    const children = tree.slice(1, 7);
    expect(children.map((c) => c._id)).toEqual([
      "CNI",
      "RECEPISSE_CNI",
      "PASSPORT",
      "DRIVING_LICENCE",
      "STUDENT_CARD",
      "OTHER_CARD",
    ]);
    expect(children.every((c) => c.parent === "DOCUMENT" && c.isDocument)).toBe(
      true,
    );
    expect(tree.slice(7).every((c) => c.parent === null && !c.isDocument)).toBe(
      true,
    );
    expect(tree.map((c) => c._id)).toEqual(
      expect.arrayContaining([
        "PHONE",
        "WALLET_BAG",
        "KEYS",
        "ELECTRONICS",
        "JEWELLERY",
        "CLOTHING",
        "PET",
        "OTHER",
      ]),
    );
  });

  test("every category has both languages", async () => {
    for (const category of await service.list(true)) {
      expect(category.labels.fr.length).toBeGreaterThan(0);
      expect(category.labels.en.length).toBeGreaterThan(0);
    }
  });
});

describe("set", () => {
  test("adds a root, then a child of it, then replaces the child", async () => {
    await service.set(input());
    const child = await service.set(
      input({ key: "E_BIKE", parent: "BICYCLE", order: 0 }),
    );
    expect(child.parent).toBe("BICYCLE");
    const renamed = await service.set(
      input({
        key: "E_BIKE",
        parent: "BICYCLE",
        order: 1,
        labels: { fr: "VAE", en: "E-bikes" },
      }),
    );
    expect(renamed).toMatchObject({ order: 1, labels: { en: "E-bikes" } });
    const keys = (await service.list(false)).map((c) => c._id);
    expect(keys.indexOf("E_BIKE")).toBe(keys.indexOf("BICYCLE") + 1);
  });

  test("a parent that does not fit is refused on `parent`, nothing written", async () => {
    const reasonOf = async (over: Partial<CategoryInput>) =>
      (await issuesOf(service.set(input(over))))[0]?.params?.["reason"];
    expect(await reasonOf({ key: "A", parent: "A" })).toBe("self");
    expect(await reasonOf({ key: "A", parent: "GHOST" })).toBe("unknown");
    expect(await reasonOf({ key: "A", parent: "CNI", isDocument: true })).toBe(
      "notroot",
    );
    expect(
      await reasonOf({ key: "A", parent: "DOCUMENT", isDocument: false }),
    ).toBe("document");
    expect(await service.find("A")).toBeUndefined();
  });

  test("a category that has children cannot take a parent", async () => {
    const issues = await issuesOf(
      service.set(
        input({ key: "DOCUMENT", parent: "OTHER", isDocument: false }),
      ),
    );
    expect(issues[0]?.params?.["reason"]).toBe("haschildren");
  });

  test("an inactive category is out of the public list only", async () => {
    await service.set(input({ active: false }));
    expect((await service.list(false)).map((c) => c._id)).not.toContain(
      "BICYCLE",
    );
    expect((await service.list(true)).map((c) => c._id)).toContain("BICYCLE");
  });
});
