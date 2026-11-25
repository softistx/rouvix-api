import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";

const call = (path: string, app = createApp()) =>
  app.fetch(new Request(`http://localhost${path}`));

describe("probes", () => {
  test("/health answers 200 while the process is up", async () => {
    const response = await call("/health");
    expect(response.status).toBe(200);
  });

  test("/ready answers 200 once MongoDB answers and the catalogues are loaded", async () => {
    const response = await call("/ready");
    expect(response.status).toBe(200);
  });

  test("/ready answers 503 while the catalogues are not loaded", async () => {
    const response = await call(
      "/ready",
      createApp({ catalogues: () => false }),
    );
    expect(response.status).toBe(503);
  });
});

describe("/graphql", () => {
  test("a request without the client header is refused before it is parsed", async () => {
    const response = await createApp().fetch(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ viewer { roles } }" }),
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      errors: { extensions: { code: string } }[];
    };
    expect(body.errors[0]?.extensions.code).toBe(
      "auth.errors.client-header-required",
    );
  });
});
