import { GraphQLError } from "graphql";
import type { AccountsService } from "@/modules/accounts";
import { parseArgs, USAGE } from "./args";

// What the script does with its arguments: makes the platform's first admin
// (or confirms it) through the accounts service, so every rule applies.
// Returns the exit code: 0 done, 1 refused, 2 bad arguments.
export async function adminCreate(
  argv: readonly string[],
  accounts: Pick<AccountsService, "ensurePlatformAdmin">,
  log: (line: string) => void = console.log,
): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    log(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  try {
    const { account, created } = await accounts.ensurePlatformAdmin(
      parsed.args,
    );
    log(
      `${created ? "created" : "found"} the account ${account.id} and made it a platform admin`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof GraphQLError)) throw error;
    log(`refused: ${error.message} (${String(error.extensions["code"])})`);
    return 1;
  }
}
