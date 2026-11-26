import type { ReadDocumentOf } from "@softistx/mongo";
import type { AppMongo } from "@/config/db";
import { invalidInput } from "@/shared/errors";
import { locked } from "../config.errors";
import { categoryIssues } from "../config.rules";
import type { categories, LocalizedText } from "../models";

export type CategoryDocument = ReadDocumentOf<typeof categories>;

export interface CategoryInput {
  key: string;
  labels: LocalizedText;
  parent: string | null;
  isDocument: boolean;
  order: number;
  active?: boolean | undefined;
}

// The categories of item: a two-level tree, global configuration, seeded by a
// migration and edited by the platform admin. Listed in tree order: roots by
// `order`, each followed by its children.
export class CategoriesService {
  constructor(private readonly mongo: AppMongo) {}

  async list(includeInactive: boolean) {
    const all = await this.mongo.db.categories.findMany({
      filter: includeInactive ? {} : { active: true },
      sort: { order: 1, _id: 1 },
    });
    const roots = all.filter((category) => category.parent === null);
    return roots.flatMap((root) => [
      root,
      ...all.filter((category) => category.parent === root._id),
    ]);
  }

  find(key: string) {
    return this.mongo.db.categories.findById(key);
  }

  // Makes or replaces the category `key` (stated whole).
  async set(input: CategoryInput) {
    const { key, active = true, ...rest } = input;
    const fields = { ...rest, active };
    const parent =
      input.parent === null
        ? undefined
        : await this.mongo.db.categories.findById(input.parent);
    const children = await this.mongo.db.categories.findMany({
      filter: { parent: key },
    });
    const issues = categoryIssues(input, parent, children);
    if (issues.length > 0) throw invalidInput(issues);
    return locked(false, () =>
      this.mongo.transaction(async (tx) => {
        const existing = await tx.db.categories.findById(key);
        return existing
          ? tx.db.categories.update(key, fields)
          : tx.db.categories.create({ _id: key, ...fields });
      }),
    );
  }
}
