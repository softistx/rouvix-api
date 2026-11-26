import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ephemeralIdVault, idVault } from "./id-vault";

const key = randomBytes(32);

describe("idVault", () => {
  test("seals and opens a value, never in clear, never twice the same", () => {
    const vault = idVault(key);
    const fields = { number: "9907315846", surname: "ESSAI" };
    const a = vault.seal(fields);
    const b = vault.seal(fields);
    expect(a).not.toBe(b);
    expect(a).toStartWith("v1.");
    for (const secret of ["9907315846", "ESSAI", "OTkwNzMxNTg0Ng"]) {
      expect(a).not.toContain(secret);
    }
    expect(vault.open<typeof fields>(a)).toEqual(fields);
  });

  test("an altered text or another key does not open", () => {
    const sealed = idVault(key).seal({ number: "1" });
    const [v, iv, body = ""] = sealed.split(".");
    const flipped = `${v}.${iv}.${body.slice(0, -2)}${body.endsWith("A") ? "B" : "A"}${body.slice(-1)}`;
    expect(() => idVault(key).open(flipped)).toThrow();
    expect(() => ephemeralIdVault().open(sealed)).toThrow();
    expect(() => idVault(key).open("plain")).toThrow(TypeError);
  });

  test("the number hash is keyed, stable, and per country", () => {
    const vault = idVault(key);
    const hash = vault.numberHash("CM", "9907315846");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(vault.numberHash("CM", "9907315846")).toBe(hash);
    expect(vault.numberHash("GA", "9907315846")).not.toBe(hash);
    expect(ephemeralIdVault().numberHash("CM", "9907315846")).not.toBe(hash);
  });

  test("a key of another length is refused", () => {
    expect(() => idVault(randomBytes(16))).toThrow(TypeError);
  });
});
