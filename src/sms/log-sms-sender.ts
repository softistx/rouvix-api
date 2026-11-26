import type { SmsMessage, SmsSender } from "./sms";

// The development adapter: prints the message instead of sending it. It
// never leaves the process, so it is refused in production (src/config/env.ts).
// The number is masked in the line, the text is not: the code is the point.
export function logSmsSender(
  log: (line: string) => void = console.log,
): SmsSender {
  return {
    async send({ to, text, countryCode }: SmsMessage) {
      log(
        `[sms] to ${to.slice(0, 4)}••••${to.slice(-2)} (${countryCode}): ${text}`,
      );
    },
  };
}
