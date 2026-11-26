import { trustProxy } from "@softistx/alxia";
import { defineEnv } from "@softistx/alxia-env";
import { z } from "zod";
import { isPrivateServiceUrl } from "@/ocr/private-url";

// A range or an address trustProxy accepts: it throws on any other.
const isRange = (range: string) => {
  try {
    trustProxy({ trusted: [range], untrusted: "refuse" });
    return true;
  } catch {
    return false;
  }
};

const production = Bun.env.NODE_ENV === "production";

// Required in production; elsewhere `fallback` stands in.
const inProduction = <T extends z.ZodType>(schema: T, fallback: string) =>
  production ? schema : schema.prefault(fallback as never);

// Optional outside production, required in it: an empty value is unset.
const orUnset = (schema: z.ZodType<string, string>) =>
  production
    ? schema
    : z
        .string()
        .transform((value) => value || undefined)
        .pipe(schema.optional())
        .optional();

const smtpUrl = z
  .string()
  .regex(/^smtps?:\/\/[^/]/, "not an smtp:// or smtps:// URL");

const redisUrl = z
  .string()
  .regex(/^rediss?:\/\/[^/]/, "not a redis:// or rediss:// URL");

const secret = z.string().min(32, "at least 32 characters");

// Optional, all or none (checked below): an unset or empty value is unset.
const optional = (schema: z.ZodType<string, string>) =>
  z
    .string()
    .transform((value) => value || undefined)
    .pipe(schema.optional())
    .optional();

// Checked once, when this module is first imported: a malformed variable stops
// the process, with every issue, before it listens.
const parsed = defineEnv({
  // mongodb:// or mongodb+srv://, with the database in its path. Transactions
  // need a replica set: docker-compose.yml starts a one-node one.
  MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "not a MongoDB URI"),
  PORT: z.coerce.number().default(3000),
  // Outside production only, behind a proxy: its range. Production uses
  // PROXY_SECRET (the API has no public hostname, rouvix-ui's BFF calls it).
  TRUSTED_PROXIES: z
    .string()
    .transform((list) =>
      list
        .split(",")
        .map((range) => range.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().refine(isRange, "not a CIDR range or address")))
    .transform((ranges) => (ranges.length > 0 ? ranges : undefined))
    .optional(),
  // Shared with rouvix-ui's BFF, which sends it in x-rouvix-proxy-secret: a
  // request that carries it has its client IP read from X-Forwarded-For
  // (src/http/client-ip.ts). Required in production.
  PROXY_SECRET: production
    ? secret
    : z
        .string()
        .transform((value) => value || undefined)
        .pipe(secret.optional())
        .optional(),
  // rouvix-ui's base URL, which every link of a mail starts with.
  UI_URL: inProduction(
    z
      .url({ protocol: production ? /^https$/ : /^https?$/ })
      .transform((url) => url.replace(/\/+$/, "")),
    "http://localhost:5173",
  ),
  // The address every mail is sent from.
  MAIL_FROM: inProduction(z.email(), "no-reply@rouvix.test"),
  // The SMTP server mails leave through. Required in production; unset
  // elsewhere, mails are printed (src/mail/mailer.ts).
  MAIL_URL: production
    ? smtpUrl
    : z
        .string()
        .transform((url) => url || undefined)
        .pipe(smtpUrl.optional())
        .optional(),
  // The Redis the rate limits count in. Required in production; unset
  // elsewhere, nothing is throttled (src/config/redis.ts).
  REDIS_URL: production
    ? redisUrl
    : z
        .string()
        .transform((url) => url || undefined)
        .pipe(redisUrl.optional())
        .optional(),
  // The SMS adapter: `log` prints the message (development, the default
  // outside production), `africastalking` sends it over Africa's Talking.
  // Required in production, where the log adapter is refused: a code that
  // only reaches a log signs nobody in.
  SMS_PROVIDER: production
    ? z.literal("africastalking")
    : z.enum(["log", "africastalking"]).default("log"),
  // Africa's Talking: its username, API key, the sender id registered for the
  // country, and the API base URL (the sandbox one for tests).
  AT_USERNAME: orUnset(z.string().min(1)),
  AT_API_KEY: orUnset(z.string().min(1)),
  AT_SENDER_ID: orUnset(z.string().min(1).max(11)),
  AT_BASE_URL: z
    .url()
    .default("https://api.africastalking.com")
    .transform((url) => url.replace(/\/+$/, "")),
  // The private bucket the photos live in (an S3 API: SeaweedFS in the
  // stack), reached by the API alone through the media routes: no public
  // endpoint, no presigned URL. Required in production; outside it all unset
  // means no storage (a `/media` write answers 503), and a partial set stops
  // the process.
  S3_ENDPOINT: orUnset(
    z
      .string()
      .regex(/^https?:\/\/[^/]/, "not an http:// or https:// URL")
      .transform((url) => url.replace(/\/+$/, "")),
  ),
  S3_BUCKET: orUnset(z.string().min(1)),
  S3_ACCESS_KEY_ID: orUnset(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: orUnset(z.string().min(1)),
  S3_REGION: z.string().default("us-east-1"),
  // The geocoding provider (OpenStreetMap's Nominatim): its base URL, and the
  // User-Agent its usage policy requires, which names the application and a
  // contact (set in deploy/.env, never in this public repository). Required in
  // production.
  GEOCODER_URL: z
    .url()
    .default("https://nominatim.openstreetmap.org")
    .transform((url) => url.replace(/\/+$/, "")),
  GEOCODER_USER_AGENT: inProduction(
    z.string().min(10).max(200),
    "rouvix-api-development",
  ),
  // The local OCR, the Tesseract sidecar (docker/ocr): a service on this
  // machine or its private network only, never one across the internet (an ID
  // document's photo is what it reads). Required in production; unset
  // elsewhere, every photo the OCR would check is treated as an ID document's
  // (blurred in public, no number read).
  OCR_URL: orUnset(
    z
      .string()
      .refine(isPrivateServiceUrl, "not a private http(s) service URL")
      .transform((url) => url.replace(/\/+$/, "")),
  ),
  // Claude, which suggests an object's description from its photo (spec
  // §4.3): its API key and model. Unset, there is no suggestion
  // (`ai.errors.suggestion-unavailable`) and the declare form works without one. The
  // model is the newest the @softistx/ai-anthropic docs name.
  ANTHROPIC_API_KEY: z
    .string()
    .transform((value) => value || undefined)
    .pipe(z.string().min(1).optional())
    .optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  // Claude calls a day, for the whole platform; past it, no suggestion.
  CLAUDE_DAILY_CAP: z.coerce.number().int().min(0).default(200),
  // The local Ollama (the `ollama-embed` service, `nomic-embed-text`) that
  // embeds the listings' text: a service on this machine or its private
  // network only. Unset, nothing is embedded and a search ranks by its text
  // score alone.
  OLLAMA_URL: z
    .string()
    .transform((value) => value || undefined)
    .pipe(
      z
        .string()
        .refine(isPrivateServiceUrl, "not a private http(s) service URL")
        .transform((url) => url.replace(/\/+$/, ""))
        .optional(),
    )
    .optional(),
  // The key ID documents' OCR fields are sealed with, and their numbers
  // hashed by: 32 random bytes in base64 (openssl rand -base64 32). Required
  // in production; unset elsewhere, a key of this process (lost at restart).
  ID_FIELDS_KEY: orUnset(
    z
      .string()
      .refine(
        (value) =>
          /^[A-Za-z0-9+/]{43}=$/.test(value) &&
          Buffer.from(value, "base64").length === 32,
        "not 32 bytes in base64",
      ),
  ),
  // Web Push's VAPID keys (RFC 8292), all or none: a P-256 public key (65
  // bytes, base64url, the one rouvix-ui's browsers subscribe with), its private
  // key (32 bytes, base64url, never returned or logged) and the contact push
  // services may write to (`mailto:` or `https:`). None: push is off.
  VAPID_PUBLIC_KEY: optional(z.string().regex(/^[A-Za-z0-9_-]{87}$/)),
  VAPID_PRIVATE_KEY: optional(z.string().regex(/^[A-Za-z0-9_-]{43}$/)),
  VAPID_SUBJECT: optional(
    z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+.*)$/),
  ),
});

const s3Required = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
const s3Missing = s3Required.filter((name) => parsed[name] === undefined);
if (s3Missing.length > 0 && s3Missing.length < s3Required.length) {
  throw new Error(
    `S3_* is incomplete: ${s3Missing.join(", ")} unset. Set all of ${s3Required.join(", ")}, or none for no file storage.`,
  );
}

const vapid = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;
const vapidMissing = vapid.filter((name) => parsed[name] === undefined);
if (vapidMissing.length > 0 && vapidMissing.length < vapid.length) {
  throw new Error(
    `VAPID_* is incomplete: ${vapidMissing.join(", ")} unset. Set all of ${vapid.join(", ")}, or none for no Web Push.`,
  );
}

if (parsed.SMS_PROVIDER === "africastalking") {
  const missing = (["AT_USERNAME", "AT_API_KEY"] as const).filter(
    (name) => parsed[name] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`SMS_PROVIDER=africastalking needs ${missing.join(", ")}`);
  }
}

if (parsed.PROXY_SECRET !== undefined && parsed.TRUSTED_PROXIES !== undefined) {
  throw new Error(
    "PROXY_SECRET and TRUSTED_PROXIES are both set: choose one. PROXY_SECRET trusts the requests rouvix-ui's BFF signs; TRUSTED_PROXIES trusts a network range.",
  );
}

export const env = parsed;
