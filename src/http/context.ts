import { alxia, defineMiddleware, trustProxy } from "@softistx/alxia";
import type { GraphQLContext } from "@softistx/alxia-graphql";
import { StoreFailure } from "@softistx/janus";
import {
  type Access,
  anonymous,
  denyAll,
  type ResolveViewer,
  type Viewer,
} from "../auth/access";
import { env } from "../config/env";
import { i18n } from "../i18n";
import type { Services } from "../modules";
import { unavailable } from "../shared/errors";
import type { OrganisationDirectory } from "../tenancy";
import { clientIp } from "./client-ip";
import { noStoreHeaders } from "./no-store";

export type { Access, Viewer } from "../auth/access";

export interface BaseOptions {
  // TRUSTED_PROXIES: behind a load balancer, its range. Its X-Forwarded-For
  // then sets ctx.ip, and a forwarding header from any other connection is
  // refused with a 403. Unset, no forwarding header is read.
  trusted?: string[] | undefined;
  // PROXY_SECRET: the secret rouvix-ui's BFF sends in x-rouvix-proxy-secret.
  // Set, ctx.ip is the left-most X-Forwarded-For of a request that carries it,
  // else the peer's address, and `trusted` is not used.
  proxySecret?: string | undefined;
  // Who the request is from, and what they may do: src/app.ts wires janus's;
  // without them, anonymous and nothing. A spec gives its own.
  resolveViewer?: ResolveViewer;
  access?: Access;
  // How a guard finds an organisation by its slug.
  organisations: OrganisationDirectory;
}

// The base: what every resolver reads, decorated or derived here: `env`,
// `access`, `organisations`, `viewer`, and `t` and `language`, the request's
// language.
export function createBase(options: BaseOptions) {
  const {
    trusted,
    proxySecret,
    resolveViewer = anonymous,
    access = denyAll,
    organisations,
  } = options;
  // `viewer` is the account the request names, or null. A query may be
  // anonymous, so this refuses nothing; a resolver that needs a viewer refuses
  // (src/auth/guards.ts). A session store that cannot answer is a 503
  // (`auth.errors.unavailable`), never an anonymous request: that would sign
  // everybody out during the outage.
  const viewerOf = defineMiddleware(async ({ request, reply }, next) => {
    let viewer: Viewer | null;
    try {
      viewer = await resolveViewer(request);
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return reply(
        503,
        { errors: [unavailable().toJSON()] },
        { headers: noStoreHeaders },
      );
    }
    return next({ viewer });
  });
  return alxia({
    ...(proxySecret !== undefined && {
      ip: clientIp({ secret: proxySecret }),
    }),
    ...(proxySecret === undefined &&
      trusted && { proxy: trustProxy({ trusted, untrusted: "refuse" }) }),
  })
    .decorate({ env, access, organisations })
    .use(i18n)
    .use(viewerOf);
}

export type Base = ReturnType<typeof createBase>;

// A resolver's context: graxia's, the base's, and what src/app.ts's `context`
// option adds per request: the `services` of that request. The generated
// `Resolvers` takes it (codegen.ts: `contextType`).
export type Context = GraphQLContext<Base, { services: Services }>;
