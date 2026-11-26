import { describe, expect, test } from "bun:test";

// The two compose files, read as YAML (anchors and merges resolved): what the
// owner's rules require of every stack, so a service added later cannot slip by.
type Service = {
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string } } };
  healthcheck?: { test?: unknown; interval?: string };
  ports?: unknown;
  restart?: string;
  profiles?: string[];
  environment?: Record<string, string>;
  networks?: string[];
  read_only?: boolean;
};

const load = async (path: string) => {
  const parsed = Bun.YAML.parse(await Bun.file(path).text()) as {
    services: Record<string, Service>;
  };
  return Object.entries(parsed.services);
};

const files = {
  local: "docker-compose.yml",
  deploy: "deploy/docker-compose.yaml",
};

describe.each(Object.entries(files))("the %s compose file", (_, path) => {
  test("has a CPU and a memory limit on every service", async () => {
    const missing = (await load(path))
      .filter(([, service]) => {
        const limits = service.deploy?.resources?.limits;
        return !limits?.cpus || !limits.memory;
      })
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test("every long-running service has a healthcheck that is not a frequent one", async () => {
    const heavy = (await load(path))
      .filter(([, service]) => service.restart !== "no" && !service.profiles)
      .filter(([name, service]) => {
        if (name === "api") return false; // the image's own HEALTHCHECK
        const interval = Number.parseInt(
          service.healthcheck?.interval ?? "0",
          10,
        );
        return !service.healthcheck?.test || interval < 30;
      })
      .map(([name]) => name);
    expect(heavy).toEqual([]);
  });
});

describe("the deploy compose file", () => {
  test("publishes no port and runs no database without a secret", async () => {
    const services = await load(files.deploy);
    expect(services.filter(([, s]) => s.ports !== undefined)).toEqual([]);
    const text = await Bun.file(files.deploy).text();
    for (const name of [
      "MONGO_ROOT_PASSWORD",
      "MONGO_KEYFILE",
      "MONGO_APP_PASSWORD",
      "REDIS_PASSWORD",
      "API_PROXY_SECRET",
      "AT_API_KEY",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "ID_FIELDS_KEY",
    ]) {
      expect(text).toContain(`\${${name}:?}`);
    }
  });

  test("the API runs the Africa's Talking adapter, never the log one", async () => {
    const api = (await load(files.deploy)).find(
      ([name]) => name === "api",
    )?.[1];
    expect(api?.environment?.["SMS_PROVIDER"]).toBe("africastalking");
  });

  test("the OCR, which reads ID documents, is on the internal network alone, read-only", async () => {
    const services = Object.fromEntries(await load(files.deploy));
    expect(services["ocr"]?.networks).toEqual(["internal"]);
    expect(services["ocr"]?.read_only).toBe(true);
    expect(services["api"]?.environment?.["OCR_URL"]).toBe(
      "http://rouvix-ocr:8884",
    );
    const parsed = Bun.YAML.parse(await Bun.file(files.deploy).text()) as {
      networks: Record<string, { internal?: boolean }>;
    };
    expect(parsed.networks["internal"]?.internal).toBe(true);
  });

  test("the embedder sees listing text only: on the internal network, no port, a model pulled by a one-shot on the edge", async () => {
    const services = Object.fromEntries(await load(files.deploy));
    expect(services["ollama-embed"]?.networks).toEqual(["internal"]);
    expect(services["ollama-embed-pull"]?.networks).toEqual(["edge"]);
    expect(services["ollama-embed-pull"]?.restart).toBe("no");
    expect(services["api"]?.environment?.["OLLAMA_URL"]).toBe(
      "http://rouvix-ollama:11434",
    );
  });

  test("the example env file holds no real secret", async () => {
    const text = await Bun.file("deploy/.env.example").text();
    const values = text
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.slice(line.indexOf("=") + 1));
    for (const value of values) {
      expect(value.length < 60 || value.includes("CHANGE_ME")).toBe(true);
    }
    expect(text).not.toMatch(/\+237\s*6\s*\d/);
  });
});

describe("the compose files are valid YAML with no key twice", () => {
  test("no environment variable is declared twice in a file", async () => {
    for (const path of Object.values(files)) {
      const text = await Bun.file(path).text();
      const keys = [...text.matchAll(/^ {2}([A-Z][A-Z0-9_]+): /gm)].map(
        (m) => m[1],
      );
      const twice = keys.filter((key, i) => keys.indexOf(key) !== i);
      expect(twice).toEqual([]);
    }
  });
});
