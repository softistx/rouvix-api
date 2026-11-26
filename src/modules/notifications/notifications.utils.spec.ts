import { describe, expect, test } from "bun:test";
import { escapeHtml, givenSettings, mailOf } from "./notifications.utils";

describe("givenSettings", () => {
  test("keeps the fields given, null and absent alike dropped", () => {
    expect(
      givenSettings({
        notifyMatch: false,
        emailCopies: null,
        pushPreviews: true,
      }),
    ).toEqual({ notifyMatch: false, pushPreviews: true });
    expect(givenSettings({})).toEqual({});
  });
});

describe("escapeHtml", () => {
  test("escapes markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

describe("mailOf", () => {
  const options = {
    kind: "CLAIM" as const,
    language: "en" as const,
    uiUrl: "https://app.example.test",
    path: "/me",
  };

  test("a mail with no preview names the kind of event and links the UI", () => {
    const mail = mailOf({ ...options, preview: null });
    expect(mail.subject).toBe("Rouvix · A claim concerns you.");
    expect(mail.text).toContain("https://app.example.test/me");
    expect(mail.text).toContain("section=notifications");
    expect(mail.html).toContain('href="https://app.example.test/me"');
  });

  test("a preview is escaped in the html", () => {
    const mail = mailOf({ ...options, preview: "<b>Bag</b>" });
    expect(mail.html).toContain("&lt;b&gt;Bag&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Bag");
  });
});
