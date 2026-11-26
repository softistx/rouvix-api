# Operations

## The stack

`deploy/docker-compose.yaml` runs nine containers on the VPS: `mongo` (a one-node replica set,
auth on), `mongo-init` (creates the two users), `redis`, `s3` (the private bucket's gateway),
`ocr` (the Tesseract sidecar, built from `docker/ocr`), `ollama-embed` (the embedder) with its
one-shot `ollama-embed-pull`, `api-migrate` (db:sync then db:migrate) and `api`. Every service, one-shots included, has
`deploy.resources.limits`; the healthchecks are a TCP or HTTP check in the image's own tools
(`deploy/compose.spec.ts` keeps both true of every service added later). No service publishes a
port and the API has no hostname: rouvix-ui's container joins the external `edge` network and
calls `http://rouvix-api:3000/graphql` with the proxy secret in `x-rouvix-proxy-secret`.

```sh
docker network create rouvix-edge          # once
cp deploy/.env.example deploy/.env         # fill every CHANGE_ME, chmod 600
bun deploy/deploy.ts                       # build, migrate, up, prune the old image tags
```

`bun deploy/deploy.ts` is idempotent: a rerun with nothing changed rebuilds from cache, migrates
nothing and recreates no container. The `api` refuses to start on a pending migration, so a
deployment is not zero-downtime.

## ID documents

An ID document's photo never leaves the VPS (spec §4.2): the API reads it with the `ocr` sidecar
(Tesseract, French and English, `POST /ocr` with a PNG, on the `internal` network alone, which has
no egress; read-only, the photo on standard input, never written) and blurs it whole in its own
process. `OCR_URL` must name a private service (localhost, a private address or a container name):
the API refuses to start otherwise. What the OCR read is sealed with `ID_FIELDS_KEY` (32 random
bytes, `openssl rand -base64 32`, in `deploy/.env`); keep a copy of it apart, since what it sealed
cannot be read without it, and numbers are hashed with it for matching. With the sidecar down, a
document's photo is still blurred and its listing opens with no number; an object's photo the OCR
could not check is treated as an ID's (shown blurred).

## Claude and the embeddings

Two AI services, both optional: the API runs, the declare form and the search work, without either.

- **Claude** suggests an object's description from its photo (`suggestFromPhoto`, spec §4.3). Set
  `ANTHROPIC_API_KEY` in `deploy/.env` (empty means no suggestion: `ai.errors.unavailable`).
  `ANTHROPIC_MODEL` defaults to the newest model the `@softistx/ai-anthropic` docs name. The call is
  counted in `aiUsage` (one document per UTC day: calls and tokens) and refused past
  `CLAUDE_DAILY_CAP` calls a day for the whole platform (default 200, `0` turns it off). Read the day's
  use with `db.aiUsage.find().sort({_id: -1})`. Only an object's photo goes to Claude, through the
  remote photo guard: a document category, an ID photo's key or a photo the local OCR finds ID-like
  is refused first, and an OCR that is down refuses the photo too (fail closed).
- **Ollama** (`ollama-embed`, `nomic-embed-text`, 768 dimensions) embeds each open listing's title,
  description and attributes (never an ID document's) in the background, and the search embeds its text
  query, to re-rank the matches by meaning. It sees text only and sits on `internal` with no egress; the
  model comes from `ollama-embed-pull`, a one-shot on `edge`, into the `ollama-data` volume. Down, a
  listing simply has no vector yet and a search ranks by its words. A listing published while Ollama was
  down is embedded the next time it is edited; a backfill sweep is a later item (docs/roadmap.md).

## Probes

- `GET /health`: the process is up.
- `GET /ready`: MongoDB answers a ping within a second, Redis too (when `REDIS_URL` is set), and
  the error catalogues have loaded. 503 until then. The image's `HEALTHCHECK` asks it.

## Migrations

`src/migrations/index.ts` lists them in execution order. A migration that only adds messages has a
`down` that deletes exactly the keys its `up` created; none other deletes anything
(`src/migrations/no-delete.spec.ts`). The server refuses to start while one is pending or recorded
but unknown to the build, and, outside production, applies them itself.

## The first platform admin

```sh
docker compose -f deploy/docker-compose.yaml --env-file deploy/.env run --rm api-migrate \
  bun --no-install src/scripts/admin-create/index.ts "+237 ..." --name Owner
```

It makes the account (or finds it) and names it the platform's admin; it sends nothing.
