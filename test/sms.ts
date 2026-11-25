import type { SmsMessage, SmsSender } from "@/sms";

// An SmsSender for specs: it keeps what it was asked to send.
export function memorySmsSender(): SmsSender & { sent: SmsMessage[] } {
  const sent: SmsMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
