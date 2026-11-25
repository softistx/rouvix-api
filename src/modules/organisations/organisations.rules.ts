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

// Whether a member counts as an administrator the organisation still has.
export const holdsAdmin = (member: {
  role: "AGENT" | "ADMIN";
  status: "INVITED" | "ACTIVE";
}) => member.role === "ADMIN" && member.status === "ACTIVE";
