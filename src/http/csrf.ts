import { defineMiddleware } from "@softistx/alxia";
import { definePlugin } from "@softistx/graxia";
import { fail } from "../shared/errors";
import { noStoreHeaders } from "./no-store";

// Every /graphql request must carry this header, any non-empty value (the
// client's name), or is refused before it is parsed. A browser sends a custom
// header only after a CORS preflight, so no cross-site form or link reaches a
// resolver, cookie or not.
export const clientHeader = "x-rouvix-client";

const isPageRequest = (request: Request) =>
  request.method === "GET" &&
  (request.headers.get("accept") ?? "").includes("text/html") &&
  !new URL(request.url).searchParams.has("query");

const refusal = () => ({
  errors: [
    fail("auth.errors.client-header-required", {
      params: { header: clientHeader },
      status: 403,
    }).toJSON(),
  ],
});

// A Yoga plugin on `onRequest`, not `useCSRFPrevention`, which skips the
// requests a browser preflights anyway. The IDE's page load is let through.
export const requireClientHeader = definePlugin({
  name: "require-client-header",
  onRequest({ request, respond }) {
    if (request.headers.get(clientHeader)?.trim()) return;
    if (isPageRequest(request)) return;
    respond(Response.json(refusal(), { status: 403, headers: noStoreHeaders }));
  },
});

// The same check for a route beside /graphql.
export const requireClientMiddleware = defineMiddleware(
  ({ request, reply }, next) =>
    request.headers.get(clientHeader)?.trim()
      ? next()
      : reply(403, refusal(), { headers: noStoreHeaders }),
);
