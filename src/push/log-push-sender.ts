import type { PushPayload, PushSender, PushTarget } from "./push";

// The development adapter: prints the push instead of sending it. It never
// leaves the process, so it is refused in production (src/config/push.ts). Only
// the push service's host is printed, never the endpoint's path or the keys.
export function logPushSender(
  log: (line: string) => void = console.log,
): PushSender {
  return {
    available: true,
    async send({ endpoint }: PushTarget, payload: PushPayload) {
      log(`[push] to ${new URL(endpoint).host}: ${JSON.stringify(payload)}`);
      return "sent";
    },
  };
}

// No push at all: `subscribePush` is refused and nothing is ever sent.
export function disabledPushSender(): PushSender {
  return {
    available: false,
    async send() {
      throw new Error("web push is not available");
    },
  };
}
