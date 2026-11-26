import { expect, spyOn, test } from "bun:test";
import { createConsoleMailer, redactTokens } from "./console-mailer";
import { serverMailer } from "./mailer";

const message = {
  to: { name: "Ada", address: "ada@rouvix.test" },
  subject: "Sign in",
  html: "<p>…</p>",
  text: "Open https://ui.rouvix.test/auth/magic-link?token=abc.DEF_-1&x=2 now",
};

test("the console mailer prints a mail's tokens under NODE_ENV=development alone", async () => {
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  await createConsoleMailer({ log, revealTokens: false }).send(message);
  await createConsoleMailer({ log, revealTokens: true }).send(message);
  expect(lines).toEqual([
    "[mail] to ada@rouvix.test: Sign in\nOpen https://ui.rouvix.test/auth/magic-link?token=[redacted]&x=2 now",
    `[mail] to ada@rouvix.test: Sign in\n${message.text}`,
  ]);
  // bun test runs with NODE_ENV=test: redacted by default.
  lines.length = 0;
  await createConsoleMailer({ log }).send(message);
  expect(lines[0]).toContain("token=[redacted]");
});

test("redactTokens leaves a text without a token as it is", () => {
  expect(redactTokens("no link here")).toBe("no link here");
});

test("without MAIL_URL, the server prints its mails", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await serverMailer(undefined).send(message);
    expect(log).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});
