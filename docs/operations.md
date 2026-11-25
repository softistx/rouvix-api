# Operations

## The stack

`deploy/docker-compose.yaml` runs six containers on the VPS: `mongo` (a one-node replica set,
auth on), `mongo-init` (creates the two users), `redis`, `s3` (the private bucket's gateway),
`api-migrate` (db:sync then db:migrate) and `api`. Every service, one-shots included, has
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
