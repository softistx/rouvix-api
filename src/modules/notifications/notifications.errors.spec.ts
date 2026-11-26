import { describe, expect, test } from "bun:test";
import {
  codes,
  notificationNotFound,
  pushUnavailable,
} from "./notifications.errors";

describe("codes", () => {
  test("are the module's, each under `notifications.errors.`", () => {
    expect(codes).toEqual([
      "notifications.errors.notification-not-found",
      "notifications.errors.push-unavailable",
    ]);
  });
});

describe("refusals", () => {
  test("a notice that is not the viewer's is 404", () => {
    const error = notificationNotFound();
    expect(error.extensions["code"]).toBe(
      "notifications.errors.notification-not-found",
    );
    expect(error.extensions["http"]).toMatchObject({ status: 404 });
  });

  test("no push adapter is 503", () => {
    const error = pushUnavailable();
    expect(error.extensions["code"]).toBe(
      "notifications.errors.push-unavailable",
    );
    expect(error.extensions["http"]).toMatchObject({ status: 503 });
  });
});
