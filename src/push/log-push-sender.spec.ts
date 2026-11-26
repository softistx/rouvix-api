import { describe, expect, test } from "bun:test";
import { disabledPushSender, logPushSender } from "./log-push-sender";

const target = {
  endpoint: "https://push.example.com/send/secret-device-id",
  p256dh: "key-material",
  auth: "auth-secret",
};

describe("logPushSender", () => {
  test("prints the host and the payload, never the endpoint's path or the keys", async () => {
    const lines: string[] = [];
    const sender = logPushSender((line) => lines.push(line));
    expect(sender.available).toBe(true);
    expect(await sender.send(target, { title: "Rouvix" })).toBe("sent");
    expect(lines).toEqual(['[push] to push.example.com: {"title":"Rouvix"}']);
    expect(lines.join()).not.toContain("secret-device-id");
    expect(lines.join()).not.toContain("auth-secret");
  });
});

describe("disabledPushSender", () => {
  test("is unavailable and sends nothing", async () => {
    const sender = disabledPushSender();
    expect(sender.available).toBe(false);
    await expect(sender.send(target, { title: "x" })).rejects.toThrow();
  });
});
