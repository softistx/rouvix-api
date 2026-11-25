import type { FieldIssue } from "@/shared/errors";
import { normalizePhone } from "@/shared/phone";

// The phone of an input as the API stores it (E.164), or the issue on `path`.
export function phoneOf(
  input: string,
  path = "phone",
): { phone: string } | { issue: FieldIssue } {
  const phone = normalizePhone(input);
  return phone === null
    ? { issue: { path, code: "validation.errors.invalid-format" } }
    : { phone };
}

// The words an organisation's slug may not be: the top-level routes of
// rouvix-ui (an organisation is reached at `/:slug`, so a slug equal to one of
// them would shadow the page), the API's own paths, and words that would read
// as the platform itself. Lower case, as slugs are.
export const reservedSlugs: ReadonlySet<string> = new Set([
  "sign-in",
  "sign-out",
  "sign-up",
  "login",
  "logout",
  "register",
  "auth",
  "search",
  "map",
  "items",
  "item",
  "declare",
  "claim",
  "claims",
  "me",
  "messages",
  "alerts",
  "settings",
  "moderation",
  "orgs",
  "org",
  "organisations",
  "organisation",
  "verify",
  "privacy",
  "terms",
  "help",
  "support",
  "about",
  "contact",
  "new",
  "admin",
  "platform",
  "rouvix",
  "api",
  "graphql",
  "health",
  "ready",
  "media",
  "assets",
  "static",
  "manifest",
  "sw",
  "worker",
  "offline",
  "favicon",
  "robots",
  "sitemap",
  "poster",
  "receipt",
  "receipts",
  "reports",
  "report",
  "notifications",
  "null",
  "undefined",
]);

export const isReservedSlug = (slug: string) => reservedSlugs.has(slug);

// Whether a member counts as an administrator the organisation still has.
export const holdsAdmin = (member: {
  role: "AGENT" | "ADMIN";
  status: "INVITED" | "ACTIVE";
}) => member.role === "ADMIN" && member.status === "ACTIVE";
