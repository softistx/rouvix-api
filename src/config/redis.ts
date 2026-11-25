import { connectRedis } from "@softistx/redis";
import { env } from "./env";

// Redis, for what the next slices count and queue in it (the sign-in code
// throttles, the photo and matching jobs): `/ready` pings it when it is
// configured. Unset outside production, the server logs `redis off`. The
// connection never blocks a request or the start: no offline queue, a one
// second connection attempt. Redis is reached through @softistx/redis only.
export const openAppRedis = (uri: string) =>
  connectRedis(uri, { enableOfflineQueue: false, connectionTimeout: 1_000 });

export type AppRedis = Awaited<ReturnType<typeof openAppRedis>>;

export const redis: AppRedis | undefined =
  env.REDIS_URL === undefined ? undefined : await openAppRedis(env.REDIS_URL);
