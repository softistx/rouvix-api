import { disabledPushSender, logPushSender, type PushSender } from "@/push";
import { env } from "./env";

// The server's Web Push adapter. No VAPID key: push is off (`subscribePush` is
// refused, the in-app notices and the e-mail copies go on). Keys outside
// production: the log adapter, which prints what it would send.
//
// There is no production adapter yet: no in-house package signs and encrypts a
// Web Push request (RFC 8030, 8291, 8292), and this API writes no cryptography
// of its own. Until one is released, keys set in production stop the process
// rather than let subscribers believe pushes leave.
export function serverPush(
  vapidPublicKey: string | undefined = env.VAPID_PUBLIC_KEY,
  production: boolean = Bun.env.NODE_ENV === "production",
): PushSender {
  if (vapidPublicKey === undefined) return disabledPushSender();
  if (production) {
    throw new Error(
      "VAPID_* is set but no Web Push adapter exists for production yet: unset it, push stays off",
    );
  }
  return logPushSender();
}
