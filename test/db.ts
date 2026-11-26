import { ObjectId } from "mongodb";
import { mongo } from "@/config/db";
import categorySeeds from "@/migrations/2026-11-26-categories/categories.json";
import countrySeeds from "@/migrations/2026-11-26-countries/countries.json";
import safePlaceSeeds from "@/migrations/2026-11-26-safe-places/safe-places.json";
import { insertMissing } from "@/migrations/kit";

// The collections `clearDatabase` keeps: the global ones (translations and the
// config module's countries, categories and safe places, which the migrations
// seed once per run) and the migrations' own records. A spec that writes the
// config collections calls `resetConfig` in its `beforeEach`.
export const globalCollectionNames: readonly string[] = [
  "translations",
  "countries",
  "categories",
  "safePlaces",
  "nxgt_migrations",
  "nxgt_migrations_lock",
];

// Empties every collection of the test database but the global ones, keeping
// its indexes and validators: what a spec calls in `beforeEach` when it counts
// or lists. It refuses any database whose name does not end in "-test".
export async function clearDatabase() {
  const { db } = mongo;
  if (!db.databaseName.endsWith("-test")) {
    throw new Error(`clearDatabase: refusing database ${db.databaseName}`);
  }
  const collections = await db.collections();
  await Promise.all(
    collections
      .filter((c) => !globalCollectionNames.includes(c.collectionName))
      .map((c) => c.deleteMany({})),
  );
}

// Puts the config collections back to their seed: what the migrations wrote and
// nothing else. For a spec that edits countries, categories or safe places.
export async function resetConfig() {
  const { db } = mongo;
  const seeds = [
    ["categories", categorySeeds],
    ["countries", countrySeeds],
    [
      "safePlaces",
      safePlaceSeeds.map((p) => ({
        ...p,
        _id: new ObjectId(p._id),
        deletedAt: null,
      })),
    ],
  ] as const;
  for (const [name, documents] of seeds) {
    await db.collection(name).deleteMany({});
    await insertMissing(
      { db: db as never, session: undefined, migration: "spec" },
      name,
      documents,
    );
  }
}
