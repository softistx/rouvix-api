# rouvix-api: specification (v1)

The GraphQL API of rouvix, a lost & found app for documents and objects, Cameroon
first. This document is the v1 contract: tenancy, roles, ports, modules, matching, the
AI pipeline, jobs, security and error codes. The UI's side is `rouvix-ui/docs/spec.md`;
the slices are the issues listed in the tracking issue. The product decisions behind it
are in `../.handover/design-decisions.md` (settled with the owner on 2026-11-25).

## 1. Scope and principles

- **Two sides of one item**: a **listing** is either `LOST` (declared by its owner) or
  `FOUND` (declared by a finder or an organisation). rouvix matches them, the owner
  proves the item is theirs (a **claim**), and the two meet for a **handover** closed by
  a 6-digit code.
- **Open to read, verified to act**: search, the map, a listing's public detail and an
  organisation's public page need no account. Declaring, claiming, chatting, saving an
  alert and reporting need an account verified by phone.
- **Zone**: francophone Africa, Cameroon first (+237; CNI, récépissé de CNI, passport,
  driving licence, student card). Other countries are configuration (§5.2), not code.
  Messages in French and English.
- **Privacy of ID documents**: the photo of an ID document is processed on the VPS only
  (local OCR and blur, §4), shown blurred in public with its number partly masked, and
  deleted when the listing closes. Detail goes only to an owner whose proof passed.
- **No money in v1**: thanks and a finder badge. Rewards and paid org plans are v2.
- **Stack**: Bun, alxia (`@alxia/core`, `@alxia/graphql`, `@alxia/i18n`), GraphQL Yoga,
  `@softistx/mongo` (MongoDB 8), `@softistx/redis` (cache, throttles, queues),
  `@softistx/s3`, `@softistx/janus` (multi-tenant), `@softistx/mail`, and the house AI
  SDK `@softistx/ai-*`. Conventions are the `alxia-graphql-api` plugin's (module per
  role, guards first, error codes inventory, committed `schema.graphql`, `scoped()`
  tenancy, data migrations that only grow).
- **Transport**: GraphQL for everything. Media go through `@alxia/media` routes over a
  private bucket (keys in the schema, never URLs). The API has no public hostname: the
  UI's BFF calls it server side.
- **Deploy**: the VPS, Docker compose with `deploy.resources.limits` on every service
  (api, worker, mongo, redis, seaweedfs or minio, ocr, ollama-embed), light
  healthchecks, old images pruned after each deploy.

## 2. Tenancy and roles

- **Spaces**: the **platform** (every user's own listings, claims, chats and alerts)
  and one janus **tenant per organisation**, reached in the UI at `/:slug`. A user
  account is global; membership of an organisation is a role inside its tenant.
  Organisation collections (`members`, `registerEntries`, org settings) are read through
  `scoped()`; a spec per module proves another organisation gets `not-found`.
- **Roles**:

| Role | Who | May |
| --- | --- | --- |
| visitor | no account | search, map, public listing detail, org public pages, verify a loss receipt |
| `USER` | phone-verified account | declare, claim, chat, hand over, review, report, save alerts, download receipts and posters |
| org `AGENT` | member of an organisation | the register (intake, storage, handover, destruction), publish register items as found listings, answer claims on them |
| org `ADMIN` | member of an organisation | an agent's rights, plus members, the public page and org settings; asks for verification |
| `MODERATOR` | named by the platform admin | reports, org verification, account suspension, the audit log |
| `PLATFORM_ADMIN` | the owner | a moderator's rights, plus moderators, countries, categories and platform settings |

- Guards (in `src/auth` only): `requireUser`, `requireOrgAgent(slug)`,
  `requireOrgAdmin(slug)`, `requireModerator`, `requirePlatformAdmin`. A suspended
  account passes no guard (`accounts.errors.suspended`).
- Bootstrap: `bun run admin:create <phone>` makes the first platform admin.

## 3. Ports

Every outside service sits behind a module port, passed explicitly (never defaulted),
with a fake in specs.

| Port | v1 adapter | Notes |
| --- | --- | --- |
| `SmsSender` | Africa's Talking (HTTP) | sends the sign-in code; per-country sender id; a log adapter in development |
| `Mailer` | `@softistx/mail` + `@softistx/mail-smtp` | fallback for the sign-in code once an e-mail is verified; notifications |
| `Ocr` | a Tesseract HTTP sidecar on the VPS (`ocr` service, fra + eng) | text and boxes of an ID photo; never a remote service |
| `ImageRedactor` | local, in the worker process | strong blur of an ID photo, EXIF stripped from every photo |
| `ObjectDescriber` | Claude through `@softistx/ai-anthropic` (`generateObject`) | photos of objects only (§4.3) |
| `Embedder` | Ollama `nomic-embed-text` on the VPS through `@softistx/ai-ollama` (embeddings port, softistx/ai#205) | 768 dimensions |
| `Geocoder` | Nominatim (OpenStreetMap), cached in Redis | place search and reverse geocoding; usage policy respected (1 req/s, own User-Agent) |
| `PushSender` | Web Push (VAPID keys from the environment) | |
| `Throttle` | `@softistx/redis` | fail closed for sign-in codes, open elsewhere |
| `Clock` | system clock | passed to every job and rule |

## 4. The AI pipeline

Photos are processed in a background job (Redis queue), never in the request. A
listing is published only once its photos are processed (`Photo.status: PENDING |
READY | FAILED`); a failed photo is dropped with a notice to its author.

### 4.1 Every photo

- MIME type sniffed server side (jpeg, png, webp; ≤ 8 MB; up to 5 photos), EXIF and GPS
  stripped, resized to 1600 px. The original key stays private.

### 4.2 ID documents (local only)

- Category `DOCUMENT` (or a photo the local OCR finds ID-like, §4.3) goes to the `Ocr`
  port on the VPS: document type hint, number, names, dates, MRZ when present.
- The OCR fields are stored **encrypted** (`idFields`, key from the environment) and
  used for matching (§6) and proof checks (§5.9). The number is also stored as a keyed
  hash of its normalised form (`idNumberHash`), so matching needs no decryption.
- The public image is the whole document **strongly blurred** (`ImageRedactor`); no
  region-level unblurring in v1. The public text shows the document type, the issuing
  country, the holder's first name and last-name initial, and the number with all but
  its first two characters masked (`12••••••••`). The last digits are what a claim asks
  for, so they are never public.
- The original photo, the blurred photo and `idFields` are deleted when the listing
  closes (§7).

### 4.3 Objects (Claude)

- Before any call, a guard checks the category is not `DOCUMENT` and runs the local OCR
  in "ID-like" mode (MRZ, "RÉPUBLIQUE DU CAMEROUN", a document number pattern of a
  configured country). An ID-like photo is never sent: the declare form is asked to
  switch to `DOCUMENT` (`ai.errors.document-photo`). A spec proves the describer is not
  called for such a photo.
- `ObjectDescriber` returns a **suggestion**: category, title, description, colours,
  brand, distinctive marks, each the user accepts or edits. Nothing is published from the
  model alone. Prompt and schema are versioned; output framed as untrusted data.
- Claude down or out of budget: the form works without a suggestion.

### 4.4 Embeddings

- Each published listing's text (title, description, accepted attributes; never the ID
  fields) is embedded with `Embedder` and stored on the listing (`embedding`, 768).
- Matching narrows candidates by category, country, place and date before comparing
  vectors, so an exact cosine over the candidates is enough; no vector index in v1.

## 5. Modules

Each module: model, collections, SDL, service with spec, resolver, error codes, e2e spec.

### 5.1 `auth` and `accounts` (slice 1)

- janus accounts identified by phone (E.164). Sign-in and sign-up are one flow:
  `requestSignInCode(phone, channel: SMS | EMAIL)` sends a 6-digit code (TTL 10 min,
  5 attempts), `confirmSignInCode(phone, code)` opens the session; a first sign-in asks
  for a display name. E-mail is a fallback channel once an address is verified.
  Throttled per phone and per address (fail closed).
- The slice first checks that janus supports a phone identifier with a sign-in code
  sent through the app's `SmsSender`; a gap is filed on softistx/janus and the slice
  waits for it (no app-side session code).
- `Account { id, displayName, phone (never public), email?, locale, countryCode,
  trustScore, finderBadge, suspendedAt, createdAt }`. `viewer` returns the account, its
  roles and its organisations.
- Organisations and members (slice 1): `createOrganisation(name, kind, slug, city)`
  (the creator becomes `ADMIN`), `inviteMember(slug, phone, role)`,
  `acceptMembership(token)`, `setMemberRole`, `removeMember`; the last admin cannot be
  removed or demoted.

### 5.2 `config`: countries, categories, places

- `Country { code, name, dialCode, phonePattern, documentTypes[], languages, mapCenter,
  idNumberPatterns[] }`, seeded with Cameroon (`CM`) by migration.
- `Category { key, labels, parent?, isDocument }`: documents (CNI, récépissé, passport,
  licence, student card, other card), phones, wallets and bags, keys, electronics,
  jewellery, clothing, pets, other.
- `SafePlace { id, countryCode, city, name, kind: POLICE | PARTNER_ORG, location,
  hours, orgId? }`: police stations seeded per city by migration; a verified
  organisation may flag itself as a handover point. `safePlacesNear(point)`.
- `geocode(query)` and `reverseGeocode(point)` through the `Geocoder` port.
- Platform admin edits countries, categories and safe places.

### 5.3 `listings` and photos

- `Listing { id, kind: LOST | FOUND, authorId, orgId?, countryCode, categoryKey,
  documentType?, title, description, attributes { colours, brand, marks }, photos[],
  place { label, point, radiusM }, date (lost or found on), status: DRAFT | PENDING |
  OPEN | CLAIMED | CLOSED | EXPIRED | REMOVED, expiresAt, extendedCount, public
  { maskedNumber?, holderHint? }, idFields (encrypted, never in the schema),
  idNumberHash?, embedding, createdAt, updatedAt, version }`.
- A `LOST` listing carries a loss area (point and radius, 200 m to 20 km); a `FOUND`
  listing a point and where the item is kept now (with the finder, at an organisation,
  at a police station).
- `declareListing(input)` (draft or publish), `updateListing` (version-locked),
  `extendListing` (+90 days), `closeListing(reason: RECOVERED | GIVEN_UP | OTHER)`,
  `removeListing`. Only its author (or its org's agents) edits it.
- Public `listing(id)` returns the masked view; the author and an owner whose claim was
  accepted see more (§8).

### 5.4 `search` and map

- `searchListings(filter, first, after)`: text (MongoDB text index, fr and en), kind,
  category, document type, city, date range, `near { point, radiusM }` ("around me"),
  status `OPEN`; a cursor connection ordered by relevance or date. Counts per kind and
  category for the filter chips.
- `mapListings(bbox, filter)`: points clustered on the server per zoom (at most 500
  markers), loss areas as circles. Never an exact point for a `LOST` listing (the circle
  only) nor the home of a private finder (rounded to ~200 m).
- Visitor reads are throttled per address.

### 5.5 `ai`

The pipeline of §4: the photo job, `suggestFromPhoto(photoKey)` (objects only), the
embedding job. Usage of Claude counted per day; a daily cap from settings.

### 5.6 `notifications` and settings

- In-app notices (`notifications` connection, `markRead`), Web Push
  (`subscribePush`, `unsubscribePush`), e-mail when verified. SMS carries the sign-in
  code only in v1 (SMS and WhatsApp alerts come later).
- `Settings { locale, notifyMatch, notifyMessage, notifyClaim, emailCopies, pushPreviews }`.
  Push payloads carry no item detail unless previews are on.

### 5.7 `matching`

See §6. `matchesFor(listingId)` for its author; `dismissMatch(matchId)`.

### 5.8 `alerts`

- `SavedAlert { id, ownerId, kind: SEARCH | MY_DOCUMENT, filter?, documentType?,
  holderName?, idNumberLast4?, place?, createdAt }`, up to 10 per account.
- `MY_DOCUMENT` ("a CNI found under my name"): the holder name is normalised and hashed,
  the last digits kept encrypted; a new `FOUND` document listing whose OCR fields match
  notifies the owner without revealing anything publicly.

### 5.9 `claims` and proof of ownership

- `Claim { id, listingId, claimantId, status: PENDING | PROOF_FAILED | ACCEPTED |
  REJECTED | WITHDRAWN | EXPIRED, answers[], last4?, selfieKey?, createdAt }`.
- On a `FOUND` listing a claimant answers the finder's questions (the finder sets 1 to 3
  when declaring; "what colour is the case?"). On an ID document the claimant also
  gives the **last 4 characters of the number** (checked automatically against
  `idFields`) and a **selfie** (private, shown to the finder or agent only once the
  digits matched, deleted at closure). No face recognition in v1: the finder compares.
- The finder (or an org agent) accepts or rejects; an accepted claim opens the chat
  (§5.10) and moves the listing to `CLAIMED`. Other pending claims stay pending until
  the handover.
- Limits: 3 open claims per account, 5 new claims per day, 3 failed proofs on one
  listing lock that account out of it, and a failed digit check counts against the
  trust score.

### 5.10 `conversations` (masked chat)

- One conversation per accepted claim (or per match both sides opened). Participants
  see each other's display names only, never a phone number.
- `sendMessage(conversationId, text, photoKey?)`. Guards on every message:
  - links and phone numbers are blocked in the first 10 messages of a conversation, and
    always for an account whose trust score is low (`conversations.errors.blocked-content`);
  - **money requests** (FR and EN patterns: "frais", "envoie", "transfert", "Orange
    Money", "MoMo", "récompense d'abord", amounts) are flagged: the message is delivered
    with a scam warning to the other side, and a moderation report is opened;
  - a scam notice is pinned at the top of every conversation.
- `reportMessage`, `blockConversation`.

### 5.11 `handovers` and reviews

- `suggestSafePlaces(conversationId)`: the nearest police stations and verified partner
  organisations between the two parties. `proposeHandover(place, at)`,
  `acceptHandover`.
- A **6-digit handover code** is generated for the owner when the handover is agreed;
  the finder enters it on the spot (`confirmHandover(code)`, 5 attempts). A good code
  closes the listing (`RECOVERED`), its match and its other claims, and deletes the ID
  photos.
- `Review { fromId, toId, handoverId, stars 1–5, thanks?, createdAt }`, one per side,
  within 14 days. A finder with 3 handovers and a 4+ average gets the **finder badge**.

### 5.12 `organisations`: register and public page

- `Organisation { id, slug, name, kind: TOWN_HALL | STATION | SCHOOL | HOTEL | POLICE |
  OTHER, city, countryCode, address, location, hours, contact, logoKey, verifiedAt?,
  verificationStatus: NONE | REQUESTED | VERIFIED | REJECTED, isSafePlace,
  destructionDelayDays (default 180), version }`.
- `requestVerification(slug, documents[])` (an official letter or registration,
  private). Only a verified organisation shows the badge and may be a safe place.
- **Register** (`registerEntries`, scoped): `RegisterEntry { id, number (per org,
  sequential), receivedAt, receivedFrom?, foundAt, categoryKey, description, photos,
  storage (shelf, box), status: STORED | PUBLISHED | HANDED_OVER | TRANSFERRED |
  DESTROYED, listingId?, handedOverTo?, events[] }`. Intake, edit, publish as a `FOUND`
  listing (the org is its finder), record a handover (with the code), a transfer (ID to
  the police or its issuer) or a destruction. Every change is an event (who, when).
- Public page: `organisationBySlug(slug)` with its verified badge, address, hours, map
  point and its open found listings.

### 5.13 `moderation`

- `Report { id, target: LISTING | MESSAGE | ACCOUNT | ORGANISATION, targetId, reason,
  reporterId?, auto: Boolean, status: OPEN | ACTIONED | DISMISSED, handledBy?, note }`.
  One open report per reporter and target.
- Moderators: report queue, remove a listing, suspend or restore an account (reason
  required, the user is told), grant or reject org verification, read the audit log.
- **Trust score** (0–100, start 50): phone age, completed handovers, reviews, upheld
  reports and failed proofs; recomputed on those events. Below 30: links and numbers
  always blocked, claims limited to 1 open.
- **Audit log** (append-only): every moderation and platform-admin action, every org
  register change, every access to a selfie or an unmasked ID field (who, what, when).
- Platform admin: name and remove moderators.

### 5.14 `documents`: loss receipt and poster

- `lossReceipt(listingId)` for the author of a `LOST` listing: a reference
  (`RVX-CM-2026-000123`), the declared facts and a verification token. The UI renders
  the PDF on its server (§ UI spec); the receipt says it is a rouvix declaration, not an
  official police document.
- `verifyReceipt(reference, token)` (public): valid or not, the date and the item type.
- `posterData(listingId)`: the public text, the first photo (blurred for a document), the
  public URL for the QR code and the share links (WhatsApp, Facebook).

## 6. Matching

- A new or edited `OPEN` listing is matched against `OPEN` listings of the other kind,
  same country, in a background job.
- **Candidates**: same category (a document type must match), place within the loss
  area plus 2 km (or the found point within it), dates compatible (found on or after
  lost on, minus 2 days).
- **Score** (0–1): an ID document whose `idNumberHash` matches scores 1. Otherwise a
  weighted sum, weights in settings and tuned later: text similarity (embedding cosine)
  0.40, distance 0.25, date gap 0.15, attributes (colour, brand, marks) 0.20.
- A score ≥ 0.6 creates a `Match { lostId, foundId, score, reasons[], status: NEW |
  SEEN | DISMISSED | CLAIMED }` and **notifies both sides**. A saved alert (§5.8) is
  checked in the same job.
- A match shows the other listing's public view only; the owner then claims.

## 7. Retention jobs

Daily jobs (worker, `Clock` passed in, idempotent, logged):

| Job | Rule |
| --- | --- |
| expiry | a listing expires 90 days after publication; a reminder 7 days before; `extendListing` adds 90 days |
| ID unclaimed | a `FOUND` ID document unclaimed after 30 days is flagged: its finder (or org) is asked to hand it to the police or its issuer, with the nearest safe places |
| ID photos | originals, blurred copies, `idFields` and selfies are deleted when a listing closes, expires or is removed |
| org destruction | a register entry stored past its org's `destructionDelayDays` is proposed for destruction (never destroyed automatically) |
| chats | a conversation's messages are deleted 90 days after its listing closes (kept longer only under an open report) |
| codes | sign-in and handover codes expire (Redis TTL) |

## 8. Security and anti-fraud

- Guards first in every resolver; owner checks on every user collection; `scoped()` on
  every organisation collection.
- **Masking**: the public view never holds a full ID number, a full holder name, a
  phone number, an exact private address, an original photo or the claim questions'
  answers. The full view of a found ID goes only to its finder; a claimant sees it only
  after acceptance, and never the original photo. A leak spec per module guards it.
- Phone OTP (fail closed throttles per phone, address and country), claim limits
  (§5.9), the report button on every listing, message and account, money-request
  detection and link blocking (§5.10), the trust score (§5.13), scam warnings.
- Secrets (`idFields` key, VAPID, SMS and Claude keys) from the environment, never
  returned. Selfies and ID originals live in a separate private bucket prefix, read only
  through an audited route.
- ID photos never reach a remote service (§4); a spec fails if `ObjectDescriber` is
  called for a document.

## 9. Error codes

Each code is in the inventory with fr and en messages (a migration). v1 codes:

- `auth.errors.phone-invalid`, `.code-invalid`, `.code-expired`, `.code-attempts`,
  `.channel-unavailable`; `accounts.errors.suspended`, `.not-found`
- `orgs.errors.not-found`, `.slug-taken`, `.not-member`, `.last-admin`, `.not-verified`
- `listings.errors.not-found`, `.not-author`, `.closed`, `.expired`,
  `.version-conflict`, `.too-many-photos`, `.radius-out-of-range`
- `media.errors.type`, `.too-large`; `ai.errors.document-photo`, `.unavailable`
- `alerts.errors.limit`
- `claims.errors.own-listing`, `.limit`, `.daily-limit`, `.locked`, `.proof-failed`,
  `.not-open`
- `conversations.errors.not-participant`, `.blocked-content`, `.blocked`
- `handovers.errors.code-invalid`, `.code-attempts`, `.not-agreed`
- `register.errors.not-found`, `.invalid-transition`
- `reports.errors.duplicate`; `moderation.errors.reason-required`
- `throttle.errors.too-many` (with the wait in minutes)

## 10. Out of v1

Mobile-money rewards and paid org plans (v2); SMS and WhatsApp alerts; native apps;
face recognition; region-level blurring; countries beyond Cameroon until configured.
