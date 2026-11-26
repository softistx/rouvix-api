import { describe, expect, test } from "bun:test";
import { noIdFields } from "./id-fields.rules";
import { holderHint, maskedNumber, publicIdTextOf } from "./id-text.rules";

describe("maskedNumber", () => {
  test("shows the first two characters only, the length kept", () => {
    expect(maskedNumber("9907315846")).toBe("99••••••••");
    expect(maskedNumber("AA0000017")).toBe("AA•••••••");
  });

  test("a short number is masked whole", () => {
    expect(maskedNumber("12345")).toBe("•••••");
  });
});

describe("holderHint", () => {
  test("the first given name and the last name's initial", () => {
    expect(holderHint({ givenNames: "JEAN PIERRE", surname: "ESSAI" })).toBe(
      "Jean E.",
    );
    expect(holderHint({ givenNames: "MARIE-CLAIRE", surname: "ÉSSAI" })).toBe(
      "Marie-Claire É.",
    );
  });

  test("no given name is no hint; no surname, the first name alone", () => {
    expect(holderHint({ givenNames: null, surname: "ESSAI" })).toBeNull();
    expect(holderHint({ givenNames: "JEAN", surname: null })).toBe("Jean");
  });
});

describe("publicIdTextOf", () => {
  test("nothing read is nothing shown", () => {
    expect(publicIdTextOf(noIdFields)).toEqual({
      maskedNumber: null,
      holderHint: null,
    });
  });
});
