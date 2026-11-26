// The port to Web Push: what the API sends a browser's push service. A module
// takes it as a required parameter, passed by the registry, never defaulted but
// at the app's entry point (`createApp`); a spec passes the `fakePush` of
// test/push.ts and never reaches a real push service.
//
// A subscription is what the browser gave `subscribePush`: an endpoint (the
// push service's URL) and the two keys that encrypt a payload for that browser.
// All three are secrets of their device: never returned, never logged.
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// What a push carries: JSON, `{ title, body?, url? }` (rouvix-ui's service
// worker reads it). It holds no item detail unless the account turned
// previews on, and never a phone number or an ID document's data
// (notifications.rules.ts).
export interface PushPayload {
  title: string;
  body?: string;
  // A path of the UI, opened on a click.
  url?: string;
}

// `gone`: the push service says the subscription no longer exists (404 or 410,
// the browser unsubscribed or was reset): the caller deletes it.
export type PushOutcome = "sent" | "gone";

export interface PushSender {
  // False when no adapter is wired (no VAPID keys, or none for production):
  // `subscribePush` is then refused, `notifications.errors.push-unavailable`.
  readonly available: boolean;
  // Resolves once the push service accepted the push; rejects on any other
  // failure (the caller logs it, one subscription never stops the others).
  send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>;
}
