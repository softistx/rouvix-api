import type { AppMongo } from "@/config/db";

// How a guard finds the organisation a slug names: the tenant collection read
// without a scope, as everywhere a request resolves its tenant. A port, so a
// spec can answer without a database.
export function organisationDirectory(mongo: AppMongo) {
  return {
    bySlug: (slug: string) => mongo.db.organisations.findFirst({ slug }),
  };
}

export type OrganisationDirectory = ReturnType<typeof organisationDirectory>;
