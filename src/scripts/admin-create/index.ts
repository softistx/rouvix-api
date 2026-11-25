import { serverAuth } from "@/config/auth";
import { mongo } from "@/config/db";
import { env } from "@/config/env";
import { serverSms } from "@/config/sms";
import { serverMailer } from "@/mail/mailer";
import { AccountsService } from "@/modules/accounts";
import { adminCreate } from "./run";

// `bun run admin:create <phone>`: makes the first platform admin. The sign-in
// of that account, with a code sent to the phone, comes with the sign-in
// slice; this only makes the account and its role. Exit 0 done, 1 refused,
// 2 bad arguments.
try {
  const accounts = new AccountsService(serverAuth(), {
    sms: serverSms(),
    mailer: serverMailer(env.MAIL_URL),
  });
  process.exitCode = await adminCreate(Bun.argv.slice(2), accounts);
} finally {
  await mongo.close();
}
