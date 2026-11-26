import { describe, expect, test } from "bun:test";
import { pngOf } from "~/images";
import { OcrError } from "./ocr";
import { tesseractOcr } from "./tesseract";

const TSV = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "5\t1\t1\t1\t1\t1\t10\t10\t100\t20\t95\tCAMEROUN",
].join("\n");

// A sidecar that never leaves the process: `fetch` is a list of answers.
function setup(answers: (Response | Error)[]) {
  const calls: { url: string; type: string | null; body: Uint8Array }[] = [];
  const ocr = tesseractOcr({
    url: "http://rouvix-ocr:8884/",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        type: new Headers(init?.headers).get("content-type"),
        body: new Uint8Array(await new Response(init?.body).arrayBuffer()),
      });
      const answer = answers.shift();
      if (answer === undefined) throw new Error("unexpected call");
      if (answer instanceof Error) throw answer;
      return answer;
    }) as typeof fetch,
  });
  return { ocr, calls };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as OcrError;
  }
  throw new Error("expected a failure");
};

describe("tesseractOcr", () => {
  test("posts the photo as a PNG to the sidecar and reads its TSV", async () => {
    const { ocr, calls } = setup([new Response(TSV)]);
    const result = await ocr.read(pngOf(40, 30));
    expect(result.text).toBe("CAMEROUN");
    expect(calls[0]?.url).toBe("http://rouvix-ocr:8884/ocr");
    expect(calls[0]?.type).toBe("image/png");
    expect([...(calls[0]?.body.subarray(1, 4) ?? [])]).toEqual([
      0x50, 0x4e, 0x47,
    ]);
  });

  test("a sidecar down, busy or failing is a retryable failure", async () => {
    for (const answer of [
      new TypeError("connection refused"),
      new Response("busy", { status: 429 }),
      new Response("oops", { status: 500 }),
      new Response("<html>gateway</html>"),
    ]) {
      const { ocr } = setup([answer]);
      const error = await failure(ocr.read(pngOf(10, 10)));
      expect(error).toBeInstanceOf(OcrError);
      expect(error.retryable).toBe(true);
    }
  });

  test("a refused or undecodable photo is a failure for good", async () => {
    const refused = setup([new Response("no", { status: 415 })]);
    expect((await failure(refused.ocr.read(pngOf(10, 10)))).retryable).toBe(
      false,
    );
    const bytes = setup([]);
    const error = await failure(bytes.ocr.read(new Uint8Array([1, 2, 3])));
    expect(error.retryable).toBe(false);
    expect(bytes.calls).toEqual([]);
  });

  test("refuses to be built for a service outside the private network", () => {
    expect(() => tesseractOcr({ url: "https://ocr.example.com" })).toThrow(
      TypeError,
    );
  });
});
