// A phone number as the API stores and compares it: E.164, `+` and 8 to 15
// digits, the first not a zero. The input may carry spaces, dots, dashes and
// brackets (`+237 6 00 00 00 01`), which are dropped; anything else, or no `+`
// (the country comes from the number, never from a guess), is refused.
const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s.\-()]/g, "");
  return E164.test(compact) ? compact : null;
}

// The number as a person other than its holder sees it: the country prefix
// and the last two digits, the rest masked (`+237••••••••01`). It lets an
// administrator tell two invited numbers apart and reveals neither.
export function maskPhone(phone: string): string {
  const digits = phone.slice(1);
  const prefix = phone.startsWith("+237") ? "+237" : phone.slice(0, 4);
  const middle = Math.max(0, digits.length - (prefix.length - 1) - 2);
  return `${prefix}${"•".repeat(middle)}${phone.slice(-2)}`;
}
