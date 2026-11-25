import type { Mailer } from "@softistx/mail";
import { PLATFORM, type Viewer } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import type { SmsSender } from "@/sms";
import { unknownCountry } from "./accounts.errors";
import { countryOf, type GlobalRole, rolesOf } from "./accounts.utils";

// The accounts: janus's users, with the platform's roles over them. An
// account is made by the sign-in (an upstream janus release, not here yet) or
// by `bun run admin:create`; nothing in this service signs anybody in.
export class AccountsService {
  constructor(
    private readonly auth: Pick<Auth, "accounts" | "permissions">,
    // The ports the sign-in will send its code through (`SmsSender`, then
    // `Mailer` as the fallback): wired now, used by the sign-in slice, once an
    // upstream janus release lets the app send the code.
    readonly ports: { sms: SmsSender; mailer: Mailer },
  ) {}

  // The roles `viewer` holds over the platform.
  async roles(viewer: Viewer): Promise<GlobalRole[]> {
    const subject = { type: viewer.type, id: viewer.id } as const;
    const [moderator, platformAdmin] = await Promise.all([
      this.auth.permissions.can(subject, "moderate", PLATFORM),
      this.auth.permissions.can(subject, "manage", PLATFORM),
    ]);
    return rolesOf({ moderator, platformAdmin });
  }

  // The account holding `phone` (E.164), made if nobody does, and named the
  // platform's admin: the bootstrap of `bun run admin:create`. Idempotent: a
  // second run finds the account and the relation as they are.
  async ensurePlatformAdmin(options: {
    phone: string;
    name: string;
    countryCode?: string | undefined;
  }) {
    const countryCode = options.countryCode ?? countryOf(options.phone);
    if (countryCode === null) throw unknownCountry(options.phone);
    const existing = await this.auth.accounts.findByLogin(options.phone);
    const account =
      existing ??
      (await this.auth.accounts.create({
        phone: options.phone,
        name: options.name,
        locale: "fr",
        countryCode,
        trustScore: 50,
        finderBadge: false,
        suspendedAt: null,
      }));
    await this.auth.permissions.grant(PLATFORM, "admins", {
      type: account.type,
      id: account.id,
    });
    return { account, created: existing === null };
  }
}
