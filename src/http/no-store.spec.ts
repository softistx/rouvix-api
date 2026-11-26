import { expect, test } from "bun:test";
import { StoreFailure } from "@softistx/janus";
import { createApp } from "../app";
import { clientHeader } from "./csrf";
import { BODY_LIMIT } from "./graphql-limits";

const post = (
  target: ReturnType<typeof createApp>,
  query: string,
  headers: Record<string, string> = { [clientHeader]: "spec" },
) =>
  target.request("/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query }),
  });

const noStoreOf = (response: Response) => response.headers.get("cache-control");
const app = createApp();

test("an answer is no-store", async () => {
  const response = await post(app, "{ viewer { roles } }");
  expect(response.status).toBe(200);
  expect(noStoreOf(response)).toBe("no-store");
});

test("an answer with errors is no-store", async () => {
  const response = await post(app, "{ nope }");
  expect(await response.json()).toHaveProperty("errors");
  expect(noStoreOf(response)).toBe("no-store");
});

test("an anonymous refusal is no-store", async () => {
  const response = await post(app, '{ organisation(slug: "x") { id } }');
  expect(noStoreOf(response)).toBe("no-store");
});

test("the client-header refusal is no-store", async () => {
  const response = await post(app, "{ viewer { roles } }", {});
  expect(response.status).toBe(403);
  expect(noStoreOf(response)).toBe("no-store");
});

test("the session store outage 503 is no-store", async () => {
  const down = createApp({
    resolveViewer: async () => {
      throw new StoreFailure("sessions.findSession: down", {
        slot: "sessions",
        operation: "findSession",
      });
    },
  });
  const response = await post(down, "{ viewer { roles } }");
  expect(response.status).toBe(503);
  expect(noStoreOf(response)).toBe("no-store");
});

test("a body over the limit is refused, no-store too", async () => {
  const response = await post(
    app,
    `{ viewer { roles } } #${"x".repeat(BODY_LIMIT)}`,
  );
  expect(response.status).toBe(413);
  expect(noStoreOf(response)).toBe("no-store");
});
