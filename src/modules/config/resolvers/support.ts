import { requirePlatformAdmin } from "@/auth/guards";
import type { Context } from "@/http/context";

// Whether a public list also holds the inactive entries: only the platform
// admin may ask (the guard runs before the read, and only when asked).
export async function includingInactive(
  ctx: Context,
  asked: boolean | null | undefined,
) {
  if (asked !== true) return false;
  await requirePlatformAdmin(ctx);
  return true;
}
