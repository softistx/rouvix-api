import { describe, expect, test } from "bun:test";
import { staleImageRefs } from "./images";

describe("staleImageRefs", () => {
  const listing = [
    "rouvix-api:local",
    "rouvix-api:abc123",
    "rouvix-api:<none>",
    "rouvix-ui:abc123",
    "mongo:8.0",
    "",
  ].join("\n");

  test("keeps the images the stack uses and removes the app's other tags", () => {
    expect(staleImageRefs(listing, ["mongo:8.0", "rouvix-api:local"])).toEqual([
      "rouvix-api:abc123",
    ]);
  });

  test("follows the tags the stack resolves, not a guessed TAG", () => {
    expect(staleImageRefs(listing, ["rouvix-api:abc123"])).toEqual([
      "rouvix-api:local",
    ]);
  });

  test("never touches another repository's images or an untagged one", () => {
    expect(
      staleImageRefs("rouvix-ui:x\nmongo:7\nrouvix-api:<none>", []),
    ).toEqual([]);
  });
});
