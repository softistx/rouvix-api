import { type SmsMessage, SmsSendError, type SmsSender } from "./sms";

export interface AfricasTalkingOptions {
  username: string;
  apiKey: string;
  // The registered alphanumeric sender id; without one the provider's shared
  // short code is used.
  senderId?: string | undefined;
  // `https://api.africastalking.com`, or the sandbox's base URL.
  baseUrl: string;
  // Injected in specs; Bun's `fetch` otherwise.
  fetch?: typeof fetch;
  // How long to wait for the provider, in milliseconds.
  timeoutMs?: number;
}

// The Africa's Talking adapter (HTTP, the bulk SMS endpoint). One message to
// one recipient per call; the provider answers `SMSMessageData.Recipients`
// with a status per number, and only "Success" (or "Sent") counts as accepted.
// The sandbox lives at `https://api.sandbox.africastalking.com`.
export function africasTalkingSmsSender(
  options: AfricasTalkingOptions,
): SmsSender {
  const send = options.fetch ?? fetch;
  const url = `${options.baseUrl}/version1/messaging`;
  return {
    async send({ to, text }: SmsMessage) {
      const body = new URLSearchParams({
        username: options.username,
        to,
        message: text,
      });
      if (options.senderId !== undefined) body.set("from", options.senderId);
      let response: Response;
      try {
        response = await send(url, {
          method: "POST",
          headers: {
            apiKey: options.apiKey,
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch (cause) {
        throw new SmsSendError("Africa's Talking did not answer", true, {
          cause,
        });
      }
      if (!response.ok) {
        throw new SmsSendError(
          `Africa's Talking answered ${response.status}`,
          response.status >= 500 || response.status === 429,
        );
      }
      let answer: { SMSMessageData?: { Recipients?: { status?: string }[] } };
      try {
        answer = (await response.json()) as typeof answer;
      } catch (cause) {
        throw new SmsSendError("Africa's Talking answered no JSON", true, {
          cause,
        });
      }
      const status = answer.SMSMessageData?.Recipients?.[0]?.status;
      if (status !== "Success" && status !== "Sent") {
        throw new SmsSendError(
          `Africa's Talking refused the number (${status ?? "no recipient"})`,
          false,
        );
      }
    },
  };
}
