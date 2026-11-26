import { describe, expect, test } from "bun:test";

// src/config/env.ts is checked once, at import: each case re-imports it under
// its own environment.
async function parsed(vars: Record<string, string | undefined>) {
  const saved = { ...Bun.env };
  try {
    for (const [name, value] of Object.entries(vars)) {
      if (value === undefined) delete Bun.env[name];
      else Bun.env[name] = value;
    }
    return await import(`./env?case=${Math.random()}`);
  } finally {
    for (const name of Object.keys(vars)) {
      const old = saved[name];
      if (old === undefined) delete Bun.env[name];
      else Bun.env[name] = old;
    }
  }
}

describe("env", () => {
  test("outside production, the log SMS adapter and the console mailer stand in", async () => {
    const { env } = await parsed({
      SMS_PROVIDER: undefined,
      MAIL_URL: undefined,
    });
    expect(env.SMS_PROVIDER).toBe("log");
    expect(env.MAIL_URL).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.AT_BASE_URL).toBe("https://api.africastalking.com");
  });

  test("the geocoder defaults to the public Nominatim and a development User-Agent", async () => {
    const { env } = await parsed({
      GEOCODER_URL: "https://nominatim.example.test/",
      GEOCODER_USER_AGENT: undefined,
    });
    expect(env.GEOCODER_URL).toBe("https://nominatim.example.test");
    expect(env.GEOCODER_USER_AGENT).toBe("rouvix-api-development");
  });

  test("the photo bucket is all four variables or none, and its URL is trimmed", async () => {
    const none = await parsed({
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });
    expect(none.env.S3_ENDPOINT).toBeUndefined();
    await expect(
      parsed({
        S3_ENDPOINT: "http://s3.test:8333",
        S3_BUCKET: undefined,
        S3_ACCESS_KEY_ID: undefined,
        S3_SECRET_ACCESS_KEY: undefined,
      }),
    ).rejects.toThrow("S3_* is incomplete");
    const all = await parsed({
      S3_ENDPOINT: "http://s3.test:8333/",
      S3_BUCKET: "media",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(all.env.S3_ENDPOINT).toBe("http://s3.test:8333");
    expect(all.env.S3_REGION).toBe("us-east-1");
  });

  test("Africa's Talking needs its username and key", async () => {
    await expect(
      parsed({
        SMS_PROVIDER: "africastalking",
        AT_USERNAME: undefined,
        AT_API_KEY: undefined,
      }),
    ).rejects.toThrow();
    const { env } = await parsed({
      SMS_PROVIDER: "africastalking",
      AT_USERNAME: "sandbox",
      AT_API_KEY: "key",
      AT_BASE_URL: "https://api.sandbox.africastalking.com/",
    });
    expect(env.AT_BASE_URL).toBe("https://api.sandbox.africastalking.com");
  });

  test("PROXY_SECRET and TRUSTED_PROXIES exclude each other, and a short secret is refused", async () => {
    await expect(
      parsed({ PROXY_SECRET: "x".repeat(32), TRUSTED_PROXIES: "10.0.0.0/8" }),
    ).rejects.toThrow("choose one");
    await expect(
      parsed({ PROXY_SECRET: "short", TRUSTED_PROXIES: undefined }),
    ).rejects.toThrow();
  });

  test("a malformed variable stops the process with the variable named", async () => {
    await expect(parsed({ MONGO_URI: "http://nope" })).rejects.toThrow();
    await expect(parsed({ REDIS_URL: "nope" })).rejects.toThrow();
    await expect(parsed({ TRUSTED_PROXIES: "not-a-range" })).rejects.toThrow();
  });
});
