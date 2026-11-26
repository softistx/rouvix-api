import { defineMiddleware } from "@softistx/alxia";
import { definePlugin } from "@softistx/graxia";

// The header of every /graphql answer: they hold session tokens, second-factor
// secrets and recovery codes, which no browser or proxy may cache.
export const noStoreHeaders = { "cache-control": "no-store" };

// A graxia plugin (src/app.ts, the first one). `onRequest` marks the answers a
// plugin gives with `respond()`; `onResponse` sets (overrides) the header on
// whatever response ends the request: graxia's SSE answers carry
// `cache-control: no-cache`, and its merge of `responseHeaders` keeps a header
// already set. The viewer middleware's 503 (src/http/context.ts) never reaches
// graxia and sets `noStoreHeaders` itself.
export const noStore = definePlugin({
  name: "no-store",
  onRequest({ responseHeaders }) {
    responseHeaders.set("cache-control", "no-store");
  },
  onResponse({ response, setResponse }) {
    if (response.headers.get("cache-control") === "no-store") return;
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    setResponse(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    );
  },
});

// A middleware (src/app.ts) declared BEFORE graphql()'s body limit: since
// @softistx/alxia 0.16 a declared oversize body gets core's 413 at the limit's
// step, which no graxia plugin sees; `set.headers` applies to whatever reply ends
// the request.
export const noStoreMiddleware = defineMiddleware(({ set }, next) => {
  set.headers.set("cache-control", "no-store");
  return next();
});
