// The OCR sidecar of rouvix-api (spec §3, §4.2): Tesseract behind one HTTP
// route, on the stack's internal network only (no egress, no published port).
// `POST /ocr` takes a PNG as its body and answers Tesseract's TSV, French and
// English; `GET /health` answers ok. The photo goes to Tesseract on its
// standard input and is never written to disk; nothing is logged of it.
// One read runs at a time (the container has one CPU), a few wait, and more
// are refused with a 429 the API retries.

export const MAX_BYTES = 12 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;
const MAX_WAITING = 4;

export type Recognise = (png: Uint8Array) => Promise<string>;

// Tesseract itself: `tesseract stdin stdout -l fra+eng tsv`, killed past
// TIMEOUT_MS.
export const tesseract: Recognise = async (png) => {
  const child = Bun.spawn(
    ["tesseract", "stdin", "stdout", "-l", "fra+eng", "--psm", "3", "tsv"],
    {
      stdin: png,
      stdout: "pipe",
      stderr: "ignore",
      timeout: TIMEOUT_MS,
      env: { OMP_THREAD_LIMIT: "1", PATH: Bun.env["PATH"] ?? "/usr/bin" },
    },
  );
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`tesseract exited with ${code}`);
  return out;
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The routes, over `recognise`: a spec passes its own.
export function ocrHandler(recognise: Recognise) {
  let running: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") {
      return new Response("ok");
    }
    if (request.method !== "POST" || pathname !== "/ocr") {
      return new Response("not found", { status: 404 });
    }
    if (request.headers.get("content-type") !== "image/png") {
      return new Response("a PNG only", { status: 415 });
    }
    const length = Number(request.headers.get("content-length") ?? NaN);
    if (!(length > 0 && length <= MAX_BYTES)) {
      return new Response("a body of a known length, 12 MiB at most", {
        status: 413,
      });
    }
    const png = new Uint8Array(await request.arrayBuffer());
    if (png.length !== length || !PNG.every((byte, i) => png[i] === byte)) {
      return new Response("not a PNG", { status: 415 });
    }
    if (waiting >= MAX_WAITING) return new Response("busy", { status: 429 });
    waiting += 1;
    const turn = running.then(() => recognise(png));
    running = turn.catch(() => undefined);
    try {
      const tsv = await turn;
      return new Response(tsv, {
        headers: { "content-type": "text/tab-separated-values; charset=utf-8" },
      });
    } catch {
      return new Response("the read failed", { status: 500 });
    } finally {
      waiting -= 1;
    }
  };
}

if (import.meta.main) {
  const port = Number(Bun.env["PORT"] ?? 8884);
  Bun.serve({
    port,
    fetch: ocrHandler(tesseract),
    maxRequestBodySize: MAX_BYTES,
  });
  console.log(`rouvix-ocr: listening on ${port}`);
}
