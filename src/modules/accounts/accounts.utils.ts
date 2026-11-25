// The countries the platform serves, by dial code: Cameroon first. Another
// country is configuration (spec §5.2), added here until that module exists.
const DIAL_CODES: Readonly<Record<string, string>> = { "+237": "CM" };

// The ISO country of an E.164 number, or null when its dial code is unknown.
export function countryOf(phone: string): string | null {
  const prefix = Object.keys(DIAL_CODES).find((code) => phone.startsWith(code));
  return prefix === undefined ? null : (DIAL_CODES[prefix] ?? null);
}

export type GlobalRole = "USER" | "MODERATOR" | "PLATFORM_ADMIN";

// The roles of an account over the platform: every account is a `USER`; a
// platform admin is a moderator too. Organisation roles are the memberships.
export function rolesOf(held: {
  moderator: boolean;
  platformAdmin: boolean;
}): GlobalRole[] {
  return [
    "USER",
    ...(held.moderator ? (["MODERATOR"] as const) : []),
    ...(held.platformAdmin ? (["PLATFORM_ADMIN"] as const) : []),
  ];
}
