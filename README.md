# rouvix-api

The GraphQL API of rouvix, a lost & found app for documents and objects, Cameroon first. Bun,
alxia, GraphQL Yoga, `@softistx/mongo`, `@softistx/redis`, `@softistx/janus`. The specification
is [docs/spec.md](docs/spec.md), the roadmap [docs/roadmap.md](docs/roadmap.md), the rules for
contributors [AGENTS.md](AGENTS.md), the glossary and the error codes [CONTEXT.md](CONTEXT.md),
the deployment [docs/operations.md](docs/operations.md).

The API has no public hostname: the UI's server (a BFF) calls it. `/graphql` is the only
entry point; `/health` and `/ready` are the probes. `schema.graphql` is the committed contract
the UI generates its client from.

## What is here (slice `skeleton`)

- janus accounts identified by phone (E.164), organisations as janus tenants, roles and guards
  (`src/auth`), the `viewer` query;
- organisations: `createOrganisation`, `inviteMember` (by phone), `acceptMembership`,
  `setMemberRole`, `removeMember`, the last administrator protected;
- the `SmsSender` port (log and Africa's Talking adapters) and the `Mailer`, wired for the
  sign-in;
- the error inventory with its French and English messages, `Query.errorCatalogue`;
- `bun run admin:create <phone>`, the Dockerfile, the local and deploy compose files.

Not here yet: the phone sign-in itself (`requestSignInCode`, `confirmSignInCode`). It waits for
an upstream janus release that lets an application send the sign-in code to a phone; the app
writes no session or code logic meanwhile.

## Run it

```sh
export NPM_SOFTISTX_READ_TOKEN=...   # read token of the @softistx registry
bun install
cp .env.example .env
bun run services:up                  # MongoDB (replica set), Redis, S3, in Docker
bun run dev                          # http://localhost:3000/graphql
bun run admin:create "+237 6 00 00 00 01" --name Owner   # the first platform admin
```

| Script                                  |                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `bun run verify`                        | generate, `schema:print --check`, Biome, `bun check`, tests: the green bar |
| `bun run generate`                      | resolvers' types, the inputs' Zod schemas, the typed e2e client            |
| `bun run schema:print`                  | rewrites `schema.graphql` (commit it)                                      |
| `bun run db:sync`, `bun run db:migrate` | the deployment steps, in that order                                        |
| `bun run fix`                           | Biome, fixing format                                                       |

`bun test` needs no service: it starts an in-memory MongoDB replica set.
