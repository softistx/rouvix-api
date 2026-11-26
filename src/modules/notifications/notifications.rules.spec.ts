import { describe, expect, test } from "bun:test";
import {
  isPushEndpoint,
  type PreviewSource,
  pathOf,
  previewOf,
  settingsOf,
} from "./notifications.rules";

const listing = (over: Partial<PreviewSource> = {}): PreviewSource => ({
  title: "Black backpack",
  status: "OPEN",
  authorId: "author",
  documentType: null,
  photos: [{ blurredKey: null }],
  ...over,
});

describe("settingsOf", () => {
  test("an account that never saved has every event on, no copies, no previews", () => {
    expect(settingsOf(undefined)).toEqual({
      notifyMatch: true,
      notifyMessage: true,
      notifyClaim: true,
      emailCopies: false,
      pushPreviews: false,
    });
  });

  test("keeps what was stored", () => {
    expect(
      settingsOf({ notifyMatch: false, pushPreviews: true }),
    ).toMatchObject({
      notifyMatch: false,
      notifyMessage: true,
      pushPreviews: true,
    });
  });
});

describe("isPushEndpoint", () => {
  test.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://push.example.com/send/1",
  ])("accepts %s", (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(true);
  });

  test.each([
    "http://push.example.com/send/1",
    "https://localhost/send",
    "https://127.0.0.1/send",
    "https://10.0.0.5/send",
    "https://[::1]/send",
    "https://push.example.com:8443/send",
    "https://user:pass@push.example.com/send",
    "https://printer.local/send",
    "https://db.internal/send",
    "https://intranet/send",
    "not a url",
    "",
  ])("refuses %s", (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(false);
  });
});

describe("previewOf", () => {
  test("an object's own title, to its recipient", () => {
    expect(previewOf(listing(), "someone")).toBe("Black backpack");
  });

  test("never an ID document's title", () => {
    expect(previewOf(listing({ documentType: "CNI" }), "author")).toBeNull();
  });

  test("never an object the OCR found ID-like (it has a blurred copy)", () => {
    expect(
      previewOf(listing({ photos: [{ blurredKey: "key" }] }), "author"),
    ).toBeNull();
  });

  test("never a title with a run of six digits, written however", () => {
    for (const title of [
      "Keys 600000012",
      "Phone +237 6 00 00 00 12",
      "Call 6-00-00-00-12",
      "Card 1234 5678",
    ]) {
      expect(previewOf(listing({ title }), "author")).toBeNull();
    }
  });

  test("a short number in a title stays", () => {
    expect(previewOf(listing({ title: "Phone 13 Pro" }), "a")).toBe(
      "Phone 13 Pro",
    );
  });

  test("a listing nobody may see is the author's alone", () => {
    const draft = listing({ status: "DRAFT" });
    expect(previewOf(draft, "someone")).toBeNull();
    expect(previewOf(draft, "author")).toBe("Black backpack");
  });

  test("is one line of 60 characters at most", () => {
    const long = previewOf(
      listing({ title: `Red\n  ${"x".repeat(100)}` }),
      "a",
    );
    expect(long).toHaveLength(60);
    expect(long).not.toContain("\n");
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("pathOf", () => {
  test("names no item without a preview", () => {
    expect(pathOf("MESSAGE", null)).toBe("/messages");
    expect(pathOf("MATCH", null)).toBe("/me");
    expect(pathOf("CLAIM", null)).toBe("/me");
  });

  test("opens the listing with a preview", () => {
    expect(pathOf("MATCH", { listingId: "abc" })).toBe("/items/abc");
  });
});
