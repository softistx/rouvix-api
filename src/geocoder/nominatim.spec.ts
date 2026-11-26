import { describe, expect, test } from "bun:test";
import { GeocoderError, memoryGeocodeCache } from "./geocoder";
import { nominatimGeocoder } from "./nominatim";

const place = {
  lat: "4.0511",
  lon: "9.7043",
  display_name: "Akwa, Douala, Littoral, Cameroun",
  address: { city: "Douala", country_code: "cm" },
};

// A provider that never leaves the process: `fetch` is a list of answers, the
// clock and the sleep are the spec's own.
function setup(
  answers: (Response | Error)[],
  extra: { maxQueued?: number } = {},
) {
  const calls: { url: string; userAgent: string | null }[] = [];
  const sleeps: number[] = [];
  let time = 10_000;
  const geocoder = nominatimGeocoder({
    baseUrl: "https://nominatim.test",
    userAgent: "rouvix-api-spec/1.0 (contact: spec@rouvix.test)",
    cache: memoryGeocodeCache(),
    minIntervalMs: 1_000,
    ...extra,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        userAgent: new Headers(init?.headers).get("user-agent"),
      });
      const answer = answers.shift();
      if (answer === undefined) throw new Error("unexpected call");
      if (answer instanceof Error) throw answer;
      return answer;
    }) as typeof fetch,
  });
  return { geocoder, calls, sleeps, advance: (ms: number) => (time += ms) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe("search", () => {
  test("asks Nominatim with its own User-Agent and the country, and maps the places", async () => {
    const { geocoder, calls } = setup([json([place])]);
    const found = await geocoder.search("Akwa", {
      countryCode: "CM",
      limit: 3,
    });
    expect(found).toEqual([
      {
        label: "Akwa, Douala, Littoral, Cameroun",
        point: { latitude: 4.0511, longitude: 9.7043 },
        city: "Douala",
        countryCode: "CM",
      },
    ]);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("Akwa");
    expect(url.searchParams.get("countrycodes")).toBe("cm");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(calls[0]?.userAgent).toBe(
      "rouvix-api-spec/1.0 (contact: spec@rouvix.test)",
    );
  });

  test("an identical ask, in any case and spacing, never reaches the provider again", async () => {
    const { geocoder, calls } = setup([json([place])]);
    await geocoder.search("Akwa  Douala", { limit: 5 });
    await geocoder.search(" akwa douala ", { limit: 5 });
    expect(calls).toHaveLength(1);
  });

  test("leaves out a place without coordinates, and names no city it does not know", async () => {
    const { geocoder } = setup([
      json([
        { display_name: "nowhere" },
        { lat: "1", lon: "2", display_name: "x" },
      ]),
    ]);
    const found = await geocoder.search("x", { limit: 5 });
    expect(found).toEqual([
      {
        label: "x",
        point: { latitude: 1, longitude: 2 },
        city: null,
        countryCode: null,
      },
    ]);
  });
});

describe("reverse", () => {
  test("reads the place at a point, and caches by the point rounded to 4 decimals", async () => {
    const { geocoder, calls } = setup([json(place)]);
    expect(
      (await geocoder.reverse({ latitude: 4.05111, longitude: 9.70431 }))?.city,
    ).toBe("Douala");
    await geocoder.reverse({ latitude: 4.05112, longitude: 9.70434 });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/reverse");
  });

  test("a point Nominatim knows nothing of is null, and is not asked again", async () => {
    const { geocoder, calls } = setup([json({ error: "Unable to geocode" })]);
    expect(await geocoder.reverse({ latitude: 0, longitude: 0 })).toBeNull();
    expect(await geocoder.reverse({ latitude: 0, longitude: 0 })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("the usage policy", () => {
  test("two different asks are at least a second apart, even when made at once", async () => {
    const { geocoder, sleeps, advance } = setup([
      json([place]),
      json([place]),
      json([place]),
    ]);
    advance(5_000);
    await Promise.all([
      geocoder.search("one", { limit: 1 }),
      geocoder.search("two", { limit: 1 }),
      geocoder.search("three", { limit: 1 }),
    ]);
    // The first goes at once, each next waits the full second.
    expect(sleeps).toEqual([1_000, 1_000]);
  });

  test("an ask after a long pause does not wait", async () => {
    const { geocoder, sleeps, advance } = setup([json([place]), json([place])]);
    await geocoder.search("one", { limit: 1 });
    advance(5_000);
    await geocoder.search("two", { limit: 1 });
    expect(sleeps).toEqual([]);
  });
});

describe("load", () => {
  test("identical asks made at once share one request", async () => {
    const { geocoder, calls } = setup([json([place])]);
    const [a, b, c] = await Promise.all([
      geocoder.search("akwa", { limit: 5 }),
      geocoder.search("AKWA", { limit: 5 }),
      geocoder.search("akwa ", { limit: 5 }),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  test("past the queue's depth an ask fails at once, a retryable error, and the others still run", async () => {
    const { geocoder, calls } = setup([json([place]), json([place])], {
      maxQueued: 2,
    });
    const asks = ["one", "two", "three"].map((q) =>
      geocoder.search(q, { limit: 1 }).catch((e: unknown) => e),
    );
    const settled = await Promise.all(asks);
    expect(settled[2]).toBeInstanceOf(GeocoderError);
    expect((settled[2] as GeocoderError).retryable).toBe(true);
    expect(Array.isArray(settled[0]) && Array.isArray(settled[1])).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("a failed ask does not hold up the one behind it", async () => {
    const { geocoder } = setup([json({}, 503), json([place])]);
    const first = geocoder.search("one", { limit: 1 }).catch((e: unknown) => e);
    const second = geocoder.search("two", { limit: 1 });
    expect(await first).toBeInstanceOf(GeocoderError);
    expect(await second).toHaveLength(1);
  });
});

describe("failures", () => {
  const caught = async (answer: Response | Error) => {
    const { geocoder } = setup([answer]);
    return geocoder.search("x", { limit: 1 }).catch((e: unknown) => e);
  };

  test("a network failure and a 5xx or 429 are retryable provider errors", async () => {
    for (const answer of [new Error("down"), json({}, 503), json({}, 429)]) {
      const error = await caught(answer);
      expect(error).toBeInstanceOf(GeocoderError);
      expect((error as GeocoderError).retryable).toBe(true);
    }
  });

  test("a refusal is not retryable, a body that is no JSON or no list is", async () => {
    expect(((await caught(json({}, 403))) as GeocoderError).retryable).toBe(
      false,
    );
    expect(
      ((await caught(new Response("<html>"))) as GeocoderError).retryable,
    ).toBe(true);
    expect(
      ((await caught(json({ not: "a list" }))) as GeocoderError).retryable,
    ).toBe(true);
  });

  test("a failure is not cached, and the next ask goes through", async () => {
    const { geocoder, calls } = setup([json({}, 503), json([place])]);
    await geocoder.search("x", { limit: 1 }).catch(() => undefined);
    expect(await geocoder.search("x", { limit: 1 })).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});
