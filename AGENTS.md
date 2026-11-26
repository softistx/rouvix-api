# rouvix-api: rules for agents and contributors

The GraphQL API of rouvix, a lost & found app for documents and objects, Cameroon
first: Bun, alxia, GraphQL Yoga, `@softistx/mongo`, `@softistx/redis`, `@softistx/s3`,
`@softistx/janus` and the house AI SDK `@softistx/ai-*`. The specification is
[docs/spec.md](docs/spec.md), the roadmap [docs/roadmap.md](docs/roadmap.md).

The owner's rules for every repository are in `~/.claude/CLAUDE.md`; this file states
only what is rouvix-api's own. The stack's conventions are the `alxia-graphql-api`
plugin's (`build-an-alxia-graphql-api`, `add-a-module`, its `conventions-reviewer`).

- **Coordination**: the rouvix session in `~/workspace/dev/rouvix/` coordinates; send it
  status, merges, blockers and owner questions with a recommended option.
- **Branches**: `develop` is the default branch and there is no `main`. v1 is built on
  `feat/v1`: each slice is `feat/v1-<slice>` off it, PR'd with `--base feat/v1`.
- **Public repository**: no secret, no real phone number, no real ID document, no
  private app name in code, fixtures or docs. Fixtures use fake numbers (`+237 6 00 00 00 xx`)
  and drawn documents.
- **Tenancy**: the platform space plus one janus tenant per organisation; every
  organisation collection is read through `scoped()`, and a spec per module proves
  another organisation gets `not-found`.
- **ID documents never leave the VPS**: their photos go to the local OCR and blur only,
  never to Claude or any other remote service; a guard refuses the call and a spec
  proves it. The original photo is private and deleted when the listing closes.
- **Masked by default**: no resolver returns a full ID number, a holder's full name, a
  phone number or an original ID photo to anyone but the person entitled to it (see
  spec §8); a leak spec per module guards it.
- **AI through `@softistx/ai-*` only**: no provider SDK, no app-side embeddings client.
  OCR and blur sit behind their ports. A gap is filed upstream and the slice waits.
- **CI**: Actions are disabled during the CI freeze; the local green bar is the proof
  until the monitoring session enables CI.

## Source layout

`src/` has the entry points at its root (`server.ts`, `app.ts`, its spec) and a folder per
concern: `config` (env, db, redis, sms, auth), `http` (context, schema, csrf, limits),
`auth` (`auth.ts` janus, `access.ts`, `guards.ts`), `tenancy` (`scoped()`, the directory),
`i18n` (the `ErrorCode` inventory), `sms`, `mail`, `geocoder`, `throttle`, `storage`, `ocr`
(with the readers of OCR text: the zone, the ID-like check), `redactor` and `vault` (the ports'
adapters), `shared`,
`migrations` (with its `kit/`), `scripts` and `modules`. A module is `modules/<name>/`:
flat for one entity, a folder per role (`graphql/`, `models/`, `services/`, `resolvers/`)
for several, with `<name>.errors.ts` (+ spec), `.rules.ts`, `.utils.ts`, `.janus.ts` and an
`index.ts` barrel. A spec sits beside its file; end to end is `test/e2e/`. A file stays
under 250 lines (a domain service may pass it, then each method stays under 50) and a
function under 80; in a spec, each `test(...)` callback does. No helper function at the top
of a service, a resolver or a data-loader: it goes to the module's `utils`, `rules` or `errors`.

## Auth, roles and tenancy

- Janus holds the accounts (one `user` type, login field `phone`, E.164) and the relations:
  `platform:main#admins|moderators`, `organisation:<id>#admins|agents`. Roles are relations,
  never fields. `src/auth/access.ts` is the `Access` port (`janusAccess` in production,
  `denyAll` by default at `createBase`); the guards in `src/auth/guards.ts` are the only code
  that asks it, and each is called first in a resolver (through the module's `support.ts`).
- A suspended account (`suspendedAt`) still authenticates, so `viewer` can tell it, and passes
  every guard's `requireUser`: `accounts.errors.suspended`, 403.
- An organisation's guard answers `organisations.errors.organisation-not-found` (404) both for
  an unknown slug and for one the viewer is no member of, then 403 for an agent calling an admin
  operation. Organisation-owned collections declare `tenantField` first and are read and
  written through `scoped()`; the `organisations` collection is the tenant itself.
- A phone number never leaves the API whole but to its holder (`Account.phone`, reachable
  through `Viewer.account` only); everywhere else it is masked (`maskPhone`).
  `accounts.schema.spec.ts` guards it.
- The invitation token is `<organisationId>.<32 random bytes>`, only its sha256 is stored, 7
  days; accepting it also needs the signed-in account's phone to be the invited one. No SMS
  leaves for an invitation: the token is returned to the administrator.
- Sign-in is not here: no mutation opens a session and nothing in `src/` issues or checks a
  code. Specs open sessions through janus's own `signInProven` (`test/fixtures.ts`).

## Ports

`SmsSender` (`src/sms`: the log adapter, Africa's Talking), `Mailer`, `Geocoder`, `Throttle` (`src/throttle`: Redis rate limits, fail open for visitor reads; `memoryThrottle` in `test/throttle.ts`), the search's `ListingRanker` (plain text ranking until slice 6's embeddings) the photos' `MediaBucket` (`src/storage`), and the ID document pipeline's `Ocr` (`src/ocr`: the Tesseract sidecar of `docker/ocr`, its `OCR_URL` refused unless private; `fakeOcr` in `test/ocr.ts`), `ImageRedactor` (`src/redactor`: the whole photo blurred in process) and `IdVault` (`src/vault`: `ID_FIELDS_KEY`) are passed explicitly
and never defaulted but by `createApp`, from the environment (`SMS_PROVIDER`; the log adapter is
refused in production). A spec passes `memorySmsSender` (`test/sms.ts`) and the memory mailer.

## Errors and migrations

- Each module's `<name>.errors.ts` declares `codes = defineCodes("<name>", [...])`; `auth` and
  `validation` are in `src/i18n/codes.ts`, which unions them into `ErrorCode`. The messages are
  data: a **new** migration with `upsertTranslations` and both languages' JSON (`fr` and `en`
  with the same keys and arguments), its `down` deleting exactly the keys it created. A shipped
  migration never changes. `src/i18n/coverage.spec.ts` requires a message per code and
  language, and a row in CONTEXT.md's Error codes table.
- `bun run db:sync` then `bun run db:migrate` are the deployment steps; the server refuses to
  start on a pending migration and, outside production, applies them itself.

## Checks

`bun run verify` is the green bar: `generate`, `schema:print --check` (commit `schema.graphql`
after any `.graphqls` change), `biome ci`, `bun check`, `bun test`. A GraphQL document in a spec
is held in a SCREAMING_SNAKE_CASE constant. Assert `extensions.code`, never the message.

## Configuration data and geocoding

- `countries`, `categories` and `safePlaces` (`src/modules/config`) are global platform data: no
  `organisationId`, seeded by migrations (`kit/seed-documents.ts` inserts what is missing by `_id` and
  never overwrites what the platform admin edited; its `down` deletes the ids it seeded), read by
  every request and written by the platform admin (`requirePlatformAdmin`) through `setCountry`,
  `setCategory` and the safe-place mutations. Reads are public; `includeInactive` and every write
  are the admin's. A spec that writes them calls `resetConfig()` (`test/db.ts`).
- The categories are a tree of two levels: `DOCUMENT` (`isDocument`) with the document types under
  it (`CNI`, `PASSPORT`…), then the other roots. A country's `documentTypes` are keys of live
  document categories.
- Geocoding goes through the `Geocoder` port (`src/geocoder`): the Nominatim adapter keeps one
  request a second (a queue, in this process), sends the application's own User-Agent
  (`GEOCODER_USER_AGENT`, a contact in `deploy/.env`, never in this repository) and caches every
  answer (Redis, memory without it). `geocode` and `reverseGeocode` need a signed-in account. A spec
  uses `test/geocoder.ts` and never reaches a provider; a provider that fails is the 503
  `config.errors.geocoding-unavailable`.
- The seeded police stations are one central station per city at the city's centre: names and
  points are approximate and the platform admin completes them. No real person's data is seeded.

## Listings and photos

- `listings` and `listingUploads` (`src/modules/listings`) are platform data owned by their
  author (`authorId`); `orgId` puts a listing in an organisation's register (its agents edit it)
  and is not a tenant field. Who edits is `requireListingEditor` (`src/auth/guards.ts`): the author
  or an agent of `orgId`; anybody else, and an unknown or removed listing, is the one 404
  `listings.errors.listing-not-found`.
- **Masked by default**: `Query.listing` returns `PublicListing` only, for an open or claimed
  listing. No author, no question or answer, no phone, no original photo. A place is blurred to
  three decimals (about 110 m) unless the item is kept at a police station or an organisation. For
  an ID document (`documentType` set) the free text and the attributes are withheld; it shows its
  type, its country, the number masked but its first two characters (`maskedNumber`), the holder's
  first name and last-name initial (`holderHint`) and its photos blurred whole (`blurredPhotoKeys`,
  `/media/listing-blurred`). An object's photo the local OCR finds ID-like is shown blurred too. No
  resolver returns `idFields` (sealed) or `idNumberHash`, to anyone; closing or removing the
  listing deletes its ID photos, blurred copies and fields. `test/e2e/listings.id-leak.e2e.spec.ts`
  and `listings.id-remote.e2e.spec.ts` hold it, and `RemotePhotoGuard` (`src/modules/ai`) is the
  gate any call that would send a photo off the VPS goes through. `listings.schema.spec.ts` fixes what a visitor can reach and
  `test/e2e/listings.leak.e2e.spec.ts` reads it as text.
- Photos go through `@softistx/alxia-media` (`/media/listing-photos`, `src/http/media.ts`): the
  only transport beside `/graphql`, over a private bucket (`S3_*`), a key never a URL, no presigned
  URL. The upload is sniffed (jpeg, png, webp, 8 MB), decoded and re-encoded as one WebP of 1600 px at
  most, which drops EXIF, GPS and XMP; the original is never stored. A listing carries only keys its
  author uploaded (`listingUploads`), each once. `Photo.status` is settled after the write by the
  background job (`PhotosService.settle`); a photo missing from the bucket is dropped.
- Specs use `test/bucket.ts` (an in-memory bucket) and drawn pictures (`test/images.ts`), never a
  real photo or ID image.
- Writes of a listing replace its content whole (a field given is the new value) under `version`,
  as the config module's do, rather than patching: the author's form always holds the whole. A
  declaration reports the content's issues together; an unknown country is the one early refusal.
- An account may upload thirty photos an hour (counted per account, not yet on the Throttle port); an upload never
  attached to a listing is not swept yet (a later slice). A photo that fails to settle is retried
  three times by the job and left pending (any later update of the listing settles it again); the
  removal of an ID document's photos at close is tried three times per photo and a failure is
  logged, the orphan sweep taking what remains.
- A found item may be kept at an organisation only in that organisation's register; `AT_POLICE` is
  the author's word until a safe place is linked to the listing.

## Search and the map

- `searchListings` and `mapListings` are public: no guard, `throttleVisitor(ctx)` first (the
  `throttle.errors.*` namespace is shared, like `auth` and `validation`).
- They read the derived fields of `listings` (`searchText`, `cityKey`, `geo`), written with the
  content by `storedFields` and never returned: an ID document's `searchText` is its type only, a
  place label is never searched, and `geo` is the public point snapped to about 220 m. Never query
  `place.point`. `search.schema.spec.ts` and `search.leak.e2e.spec.ts` guard this.
- `search.ranking.ts` holds the `ListingRanker` port (the ranking role).
