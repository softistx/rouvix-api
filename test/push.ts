import type { PushOutcome, PushPayload, PushSender, PushTarget } from "@/push";

export interface SentPush {
  target: PushTarget;
  payload: PushPayload;
}

// A PushSender for specs: it keeps what it was asked to send and never reaches
// a push service. `answer` sets what the next sends answer (`gone` for an
// endpoint the service forgot), `failFor` makes one endpoint throw.
export function fakePush(options: { available?: boolean } = {}) {
  const sent: SentPush[] = [];
  const gone = new Set<string>();
  const failing = new Set<string>();
  const sender: PushSender & {
    sent: SentPush[];
    gone: Set<string>;
    failing: Set<string>;
  } = {
    available: options.available ?? true,
    sent,
    gone,
    failing,
    async send(target, payload): Promise<PushOutcome> {
      if (failing.has(target.endpoint)) throw new Error("push service down");
      sent.push({ target, payload });
      return gone.has(target.endpoint) ? "gone" : "sent";
    },
  };
  return sender;
}

// A drawn browser subscription: a push service host, fake keys.
export const fakeSubscription = (n: number) => ({
  endpoint: `https://push.example.com/send/device-${n}`,
  p256dh:
    "BPfakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFake",
  auth: `fakeAuth${String(n).padStart(8, "0")}`,
});
