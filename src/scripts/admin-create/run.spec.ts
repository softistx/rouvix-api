import { beforeEach, describe, expect, test } from "bun:test";
import { createMemoryMailer } from "@softistx/mail";
import { viewerOf } from "@/auth/access";
import { AccountsService } from "@/modules/accounts";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { fakeE164 } from "~/fixtures";
import { memorySmsSender } from "~/sms";
import { adminCreate } from "./run";

let kit: AuthApp;
let accounts: AccountsService;
let lines: string[];
const log = (line: string) => lines.push(line);

beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
  lines = [];
  accounts = new AccountsService(kit.auth, {
    sms: memorySmsSender(),
    mailer: createMemoryMailer(),
  });
});

describe("adminCreate", () => {
  test("makes the first platform admin and exits 0, sending nothing", async () => {
    expect(await adminCreate(["+237 6 00 00 00 01"], accounts, log)).toBe(0);
    expect(lines[0]).toStartWith("created the account ");
    const account = await kit.auth.accounts.findByLogin(fakeE164(1));
    expect(account).not.toBeNull();
    if (account === null) return;
    expect(await accounts.roles(viewerOf(account))).toContain("PLATFORM_ADMIN");
    expect(accounts.ports.sms).toMatchObject({ sent: [] });
  });

  test("a second run finds the account and exits 0", async () => {
    await adminCreate([fakeE164(1)], accounts, log);
    expect(await adminCreate([fakeE164(1)], accounts, log)).toBe(0);
    expect(lines[1]).toStartWith("found the account ");
  });

  test("bad arguments exit 2 with the usage", async () => {
    expect(await adminCreate([], accounts, log)).toBe(2);
    expect(lines[0]).toContain("usage: bun run admin:create");
  });

  test("a number of an unserved country is refused, exit 1", async () => {
    expect(await adminCreate(["+33612345678"], accounts, log)).toBe(1);
    expect(lines[0]).toContain("accounts.errors.unknown-country");
  });
});
