import { describe, expect, test } from "bun:test";
import { noticeWords } from "./notifications.texts";

describe("noticeWords", () => {
  test("names the kind of event only, in the account's language", () => {
    expect(noticeWords("MESSAGE", "en", null)).toEqual({
      title: "Rouvix",
      body: "You have a new message.",
    });
    expect(noticeWords("MATCH", "fr", null).body).toContain("correspondre");
  });

  test("appends the preview when there is one", () => {
    expect(noticeWords("CLAIM", "en", "Black backpack").body).toBe(
      "A claim concerns you. « Black backpack »",
    );
  });
});
