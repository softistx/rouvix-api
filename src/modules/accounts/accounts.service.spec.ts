import { beforeEach, describe, expect, test } from "bun:test";
import { createMemoryMailer } from "@softistx/mail";
import { viewerOf } from "@/auth/access";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { refusal } from "~/refusals";
import { memorySmsSender } from "~/sms";
import { AccountsService } from "./accounts.service";

let kit: AuthApp;
let accounts: AccountsService;

beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
  accounts = new AccountsService(kit.auth, {
    sms: memorySmsSender(),
    mailer: createMemoryMailer(),
  });
});

describe("ensurePlatformAdmin", () => {
  test("makes the account and its role, and a second run changes nothing", async () => {
    const first = await accounts.ensurePlatformAdmin({
      phone: fakeE164(1),
      name: "Owner",
    });
    expect(first.created).toBe(true);
    expect(first.account).toMatchObject({
      phone: fakeE164(1),
      countryCode: "CM",
      suspendedAt: null,
    });
    const again = await accounts.ensurePlatformAdmin({
      phone: fakeE164(1),
      name: "Other name",
    });
    expect(again.created).toBe(false);
    expect(again.account.id).toBe(first.account.id);
    expect(again.account.name).toBe("Owner");
    expect(await kit.auth.accounts.count()).toBe(1);
  });

  test("takes the role of an account that already exists", async () => {
    const { account } = await signedIn(kit, { phone: fakeE164(2) });
    await accounts.ensurePlatformAdmin({ phone: fakeE164(2), name: "Ignored" });
    expect(await accounts.roles(viewerOf(account))).toEqual([
      "USER",
      "MODERATOR",
      "PLATFORM_ADMIN",
    ]);
  });

  test("a number of an unserved country needs --country, else is refused", async () => {
    const error = await refusal(
      accounts.ensurePlatformAdmin({ phone: "+33612345678", name: "Admin" }),
    );
    expect(error.extensions["code"]).toBe("accounts.errors.unknown-country");
    const made = await accounts.ensurePlatformAdmin({
      phone: "+33612345678",
      name: "Admin",
      countryCode: "FR",
    });
    expect(made.account.countryCode).toBe("FR");
  });
});

describe("roles", () => {
  test("a plain account is a USER only", async () => {
    const { account } = await signedIn(kit);
    expect(await accounts.roles(viewerOf(account))).toEqual(["USER"]);
  });

  test("a moderator the platform admin named is a MODERATOR, not a PLATFORM_ADMIN", async () => {
    const { account } = await signedIn(kit);
    await kit.auth.permissions.grant(
      { type: "platform", id: "main" },
      "moderators",
      { type: "user", id: account.id },
    );
    expect(await accounts.roles(viewerOf(account))).toEqual([
      "USER",
      "MODERATOR",
    ]);
  });
});
