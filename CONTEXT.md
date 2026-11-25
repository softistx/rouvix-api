# rouvix-api: glossary and error codes

The words of the domain, in English (code, SDL, collections) with their French as
rouvix-ui shows it, and every error code the API answers with. The messages of the
codes are data: `translations`, written by the migrations of `src/migrations` in
French and English. `src/i18n/coverage.spec.ts` keeps this file, the inventory
(`src/i18n/codes.ts`) and the migrations agreeing.

## Glossary

| Term           | Français                        | Meaning                                                                                                           |
| -------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| account        | compte                          | A person's janus user, global to the platform; its login field is the phone (E.164).                              |
| platform       | plateforme                      | The one space every account lives in: its own listings, claims, chats and alerts.                                 |
| organisation   | organisation                    | A verified multi-member space (town hall, station, school, hotel, police); one janus tenant, reached at `/:slug`. |
| member         | membre                          | An account's place in an organisation, `AGENT` or `ADMIN`; or a pending invitation by phone.                      |
| invitation     | invitation                      | A member document in status `INVITED`, with a token valid 7 days, accepted by the invited phone.                  |
| agent          | agent                           | A member who works the register.                                                                                  |
| admin          | administrateur                  | A member who also manages members and the organisation's page and settings.                                       |
| moderator      | modérateur                      | Named by the platform admin: reports, verification, suspensions.                                                  |
| platform admin | administrateur de la plateforme | The owner; a moderator's rights plus moderators and settings.                                                     |
| suspended      | suspendu                        | An account a moderator suspended (`suspendedAt`): it passes no guard.                                             |
| `SYSTEM_ACTOR` | acteur système                  | `00000000-0000-7000-8000-000000000000`, what a script no account runs stamps its writes with.                     |

## Error codes

Top-level codes, with when they are raised and the HTTP status. A shipped code never
changes meaning: a new case gets a new code.

| Code                                          | When                                                                                                                       | Status |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| `auth.errors.unauthenticated`                 | No signed-in account.                                                                                                      | 401    |
| `auth.errors.forbidden`                       | The account is signed in but may not do this (an agent calling an admin operation, a non-moderator, a non-platform-admin). | 403    |
| `auth.errors.unavailable`                     | janus's store (accounts, sessions, relations) did not answer; never an anonymous request.                                  | 503    |
| `auth.errors.client-header-required`          | A `/graphql` request without the client header `x-rouvix-client`; `header` names it.                                       | 403    |
| `validation.errors.invalid-input`             | An input refused as a whole; `extensions.fields` lists each field (`path`, `code`, `message`).                             | 400    |
| `accounts.errors.suspended`                   | The account is suspended: every guard of `src/auth` refuses it.                                                            | 403    |
| `accounts.errors.unknown-country`             | `bun run admin:create` with a number whose dial code is not served and no `--country`; `prefix`.                           | 400    |
| `organisations.errors.organisation-not-found` | A slug that names no organisation, or one the viewer is no member of: one answer for both.                                 | 404    |
| `organisations.errors.member-not-found`       | A member id that no live member of the organisation holds (another organisation's member included).                        | 404    |
| `organisations.errors.invitation-invalid`     | A token unknown, expired, or for another phone than the signed-in account's.                                               | 404    |
| `organisations.errors.last-admin`             | Removing or demoting the organisation's only active administrator.                                                         | 409    |
| `organisations.errors.stale-version`          | Writes on the organisation kept conflicting beyond the retry budget (about 2 s); repeat the call.                          | 409    |

Field codes: raised in `extensions.fields` beside the top-level code of the call.

| Code                                  | Input path                     | When                                                     |
| ------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `organisations.errors.slug-taken`     | `slug` of `createOrganisation` | Another organisation holds the slug (409, `slug` param). |
| `organisations.errors.already-member` | `phone` of `inviteMember`      | The phone is already an active member (409).             |
| `validation.errors.invalid-format`    | `phone` of `inviteMember`      | Not an international number (`+` and 8 to 15 digits).    |
| `validation.errors.required`          | any                            | A field that must be given.                              |
| `validation.errors.invalid`           | any                            | A value the schema refuses.                              |
| `validation.errors.too-short`         | any `@constraint(minLength)`   | A string under its minimum.                              |
| `validation.errors.too-long`          | any `@constraint(maxLength)`   | A string over its maximum.                               |
| `validation.errors.out-of-range`      | any `@constraint(min, max)`    | A number outside its range.                              |
| `validation.errors.too-few`           | any `@constraint(minItems)`    | A list under its minimum.                                |
| `validation.errors.too-many`          | any `@constraint(maxItems)`    | A list over its maximum.                                 |
