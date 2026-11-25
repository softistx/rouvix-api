import { printSchemaWithDirectives } from "@graphql-tools/utils";
import { lexicographicSortSchema } from "graphql";
import { schema } from "@/http/schema";

// Writes the schema the server runs, every module's SDL merged with the
// scalars and @constraint, sorted, with every directive usage kept (graphql-js
// printSchema drops them): schema.graphql at the repository root, the
// committed contract rouvix-ui generates its client from. With --check, writes
// nothing and exits 1 when it is stale, which `bun run verify` runs. Importing
// the schema wires the config but opens no connection to a request.
const path = `${import.meta.dir}/../../schema.graphql`;
const printed = `${printSchemaWithDirectives(lexicographicSortSchema(schema))}\n`;

if (process.argv.includes("--check")) {
  const file = Bun.file(path);
  const current = (await file.exists()) ? await file.text() : "";
  if (current !== printed) {
    console.error(
      "schema.graphql is stale: run `bun run schema:print` and commit it",
    );
    process.exit(1);
  }
} else {
  await Bun.write(path, printed);
}
process.exit(0);
