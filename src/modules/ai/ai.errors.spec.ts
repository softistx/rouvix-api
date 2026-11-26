import { describe, expect, test } from "bun:test";
import {
  aiUnavailable,
  codes,
  documentPhoto,
  photoNotFound,
} from "./ai.errors";

describe("codes", () => {
  test("are the module's, each under `ai.errors.`", () => {
    expect(codes).toEqual([
      "ai.errors.document-photo",
      "ai.errors.unavailable",
      "ai.errors.photo-not-found",
    ]);
  });
});

describe("refusals", () => {
  test("a document's photo is 422, the local check down 503", () => {
    expect(documentPhoto().extensions).toMatchObject({
      code: "ai.errors.document-photo",
      http: { status: 422 },
    });
    expect(aiUnavailable().extensions).toMatchObject({
      code: "ai.errors.unavailable",
      http: { status: 503 },
    });
    expect(photoNotFound().extensions).toMatchObject({
      code: "ai.errors.photo-not-found",
      http: { status: 404 },
    });
  });
});
