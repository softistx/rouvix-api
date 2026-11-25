import type { AuthApp } from "~/auth";

// The public repository holds fake numbers only: +237 6 00 00 00 xx.
export const fakePhone = (n: number) =>
  `+237 6 00 00 00 ${String(n).padStart(2, "0")}`;
export const fakeE164 = (n: number) => fakePhone(n).replaceAll(" ", "");

// An account holding `phone`, with a session opened through janus's own
// `signInProven` (the privileged call for a proof the server verified, which
// a spec is): no session code of the app is involved, nothing is sent. Returns
// the account and the bearer token a client sends.
export async function signedIn(
  kit: AuthApp,
  options: { phone?: string; name?: string } = {},
) {
  const phone = options.phone ?? fakeE164(1);
  const account =
    (await kit.auth.accounts.findByLogin(phone)) ??
    (await kit.auth.accounts.create({
      phone,
      name: options.name ?? "Test Person",
      locale: "fr",
      countryCode: "CM",
      trustScore: 50,
      finderBadge: false,
      suspendedAt: null,
    }));
  const session = await kit.auth.accounts.signInProven(account);
  if (session.status !== "signedIn") throw new Error("expected a session");
  return { account, token: session.token, phone };
}
