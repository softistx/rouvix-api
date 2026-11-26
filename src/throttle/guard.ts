import { ipKey } from "@/http/client-ip";
import type { Context } from "@/http/context";
import { tooMany } from "./throttle.errors";

// What a public read calls first (a visitor has no account to count): one call
// against the address's budget, `throttle.errors.too-many` (429) when spent.
export async function throttleVisitor(ctx: Pick<Context, "ip" | "throttle">) {
  const verdict = await ctx.throttle.take("visitor-read", ipKey(ctx.ip));
  if (!verdict.allowed) throw tooMany(verdict.retryAfter);
}
