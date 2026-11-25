import type { Mailer } from "@softistx/mail";
import { createSmtpMailer } from "@softistx/mail-smtp";
import nodemailer from "nodemailer";
import { createConsoleMailer } from "./console-mailer";

// The server's `Mailer`: SMTP when MAIL_URL is set, else the console (mails
// printed, link tokens redacted outside development). Wired in `createApp`
// beside `SmsSender`, used by the e-mail fallback of the sign-in code.
export function serverMailer(mailUrl: string | undefined): Mailer {
  if (!mailUrl) return createConsoleMailer();
  return createSmtpMailer({ transporter: nodemailer.createTransport(mailUrl) });
}
