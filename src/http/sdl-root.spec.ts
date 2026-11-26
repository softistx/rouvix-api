import { describe, expect, test } from "bun:test";
import { sdlRoot } from "./sdl-root";

describe("sdlRoot", () => {
  test.each([
    ["/app/dist", "/app"],
    ["/app/dist/scripts/seed-demo", "/app"],
    ["/repo/src/http", "/repo"],
    ["/x/dist/repo/src/http", "/x/dist/repo"],
    ["/x/dist/app/dist/scripts/a", "/x/dist/app"],
  ])("%s -> %s", (dir, expected) => {
    expect(sdlRoot(dir)).toBe(expected);
  });
});
