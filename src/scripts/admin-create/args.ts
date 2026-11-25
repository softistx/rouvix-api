import { normalizePhone } from "@/shared/phone";

export interface AdminCreateArgs {
  phone: string;
  name: string;
  countryCode: string | undefined;
}

export const USAGE =
  "usage: bun run admin:create <phone> [--name <display name>] [--country <ISO code>]";

// The script's arguments, or the reason they are wrong (exit code 2): the
// phone in any spelling the API accepts, stored as E.164.
export function parseArgs(
  argv: readonly string[],
): { args: AdminCreateArgs } | { error: string } {
  let phoneInput: string | undefined;
  let name = "Admin";
  let countryCode: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--name" || arg === "--country") {
      const value = argv[i + 1];
      if (value === undefined) return { error: `${arg} needs a value` };
      i += 1;
      if (arg === "--name") name = value;
      else countryCode = value.toUpperCase();
    } else if (arg.startsWith("--")) {
      return { error: `unknown option ${arg}` };
    } else if (phoneInput === undefined) {
      phoneInput = arg;
    } else {
      return { error: "one phone number only" };
    }
  }
  if (phoneInput === undefined) return { error: "the phone number is missing" };
  const phone = normalizePhone(phoneInput);
  if (phone === null) {
    return {
      error: "the phone must be an international number: +237 6 00 00 00 01",
    };
  }
  if (name.trim() === "" || name.length > 120) {
    return { error: "--name is 1 to 120 characters" };
  }
  if (countryCode !== undefined && !/^[A-Z]{2}$/.test(countryCode)) {
    return { error: "--country is an ISO 3166-1 alpha-2 code" };
  }
  return { args: { phone, name: name.trim(), countryCode } };
}
