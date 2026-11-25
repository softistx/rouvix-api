import { describe, expect, test } from "bun:test";
import { maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  test("keeps an E.164 number and drops the spaces, dots, dashes and brackets", () => {
    expect(normalizePhone("+237 6 00 00 00 01")).toBe("+237600000001");
    expect(normalizePhone(" +237.600-000(002) ")).toBe("+237600000002");
    expect(normalizePhone("+237600000003")).toBe("+237600000003");
  });

  test("refuses what is not an international number", () => {
    expect(normalizePhone("600000001")).toBeNull();
    expect(normalizePhone("00237600000001")).toBeNull();
    expect(normalizePhone("+0 600 000 001")).toBeNull();
    expect(normalizePhone("+237 6 AB 00 00 01")).toBeNull();
    expect(normalizePhone("+1234567")).toBeNull();
    expect(normalizePhone("+1234567890123456")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("maskPhone", () => {
  test("keeps the country prefix and the last two digits of a Cameroon number", () => {
    expect(maskPhone("+237600000001")).toBe("+237•••••••01");
  });

  test("masks every middle digit of any number, and never shows the whole of it", () => {
    const masked = maskPhone("+33612345678");
    expect(masked.endsWith("78")).toBe(true);
    expect(masked).not.toContain("12345");
    expect(masked.length).toBe("+33612345678".length);
  });
});
