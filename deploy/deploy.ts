#!/usr/bin/env bun

/**
 * Deploys the rouvix-api stack on this machine, by hand and idempotently: build
 * the image here (there is no registry), db:sync + db:migrate (the `api-migrate`
 * one-shot), `up`, wait for every service to be healthy, then remove the
 * previous image tags. A rerun with nothing changed rebuilds from cache,
 * migrates nothing and recreates no container.
 *
 *   bun deploy/deploy.ts [--env deploy/.env] [--timeout 300]
 *
 * The env file must exist and be mode 600 (it holds every secret).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { staleImageRefs } from "./images";

const args = Bun.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const root = join(import.meta.dir, "..");
const envFile = join(root, flag("--env", "deploy/.env"));
const timeout = flag("--timeout", "300");
const fail = (message: string): never => {
  console.error(`deploy: ${message}`);
  process.exit(1);
};

const info = await Bun.file(envFile)
  .stat()
  .catch(() => null);
if (info === null) fail(`${envFile} does not exist (copy deploy/.env.example)`);
if (((info?.mode ?? 0) & 0o077) !== 0) fail(`${envFile} must be mode 600`);

const compose = (...rest: string[]) =>
  $`docker compose -f ${join(root, "deploy/docker-compose.yaml")} --env-file ${envFile} ${rest}`;

const tokenFile = join(homedir(), ".config/secrets/npm-sofistx-read-token");
const token =
  process.env["NPM_SOFTISTX_READ_TOKEN"] ||
  ((await Bun.file(tokenFile).exists())
    ? (await Bun.file(tokenFile).text()).trim()
    : "");

const step = (name: string, detail = "") =>
  console.log(`  ${name.padEnd(9)} ${detail}`);

step("build", "api (cached layers make a rerun cheap)");
await compose("build")
  .env({ ...process.env, NPM_SOFTISTX_READ_TOKEN: token })
  .cwd(root);

step("migrate", "db:sync then db:migrate (api-migrate one-shot)");
await compose("run", "--rm", "api-migrate").cwd(root);

step("up", "");
await compose(
  "up",
  "-d",
  "--remove-orphans",
  "--wait",
  "--wait-timeout",
  timeout,
).cwd(root);

// Cleanup, now that the new containers are healthy: this app's previous image
// tags, then `docker image prune -f` and `docker builder prune -f --filter
// until=24h`, both host-wide. Never `system prune -a` and never --volumes: data
// volumes are not touched. A failure here is a warning: the deploy succeeded.
const current = (await compose("config", "--images").cwd(root).quiet().text())
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const listing = await $`docker image ls --format ${"{{.Repository}}:{{.Tag}}"}`
  .quiet()
  .nothrow()
  .text();
const stale = staleImageRefs(listing, current);
step("cleanup", `${stale.length} previous tag(s), dangling images, old cache`);
for (const ref of stale) {
  const rm = await $`docker image rm ${ref}`.quiet().nothrow();
  if (rm.exitCode !== 0) console.warn(`warning: could not remove ${ref}`);
}
await $`docker image prune -f`.quiet().nothrow();
await $`docker builder prune -f --filter until=24h`.quiet().nothrow();

await compose("ps", "--format", "table {{.Name}}\t{{.Status}}").cwd(root);
step("healthy", "rouvix-api is up");
