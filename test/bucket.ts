import type { MediaBucket } from "@softistx/alxia-media";

// A MediaBucket in memory for specs: what the media routes put is kept by
// object key, what they open is streamed back, and nothing leaves the process.
export function memoryBucket() {
  const objects = new Map<
    string,
    { bytes: Uint8Array; type: string | undefined }
  >();
  const bucket = {
    async put(
      params: { key: string },
      body: unknown,
      options?: { type?: string },
    ) {
      const bytes = new Uint8Array(
        await new Response(body as BodyInit).arrayBuffer(),
      );
      objects.set(params.key, { bytes, type: options?.type });
    },
    async open(params: { key: string }) {
      const found = objects.get(params.key);
      if (found === undefined) return undefined;
      return {
        stream: new Response(found.bytes as BodyInit)
          .body as ReadableStream<Uint8Array>,
        size: found.bytes.length,
        contentLength: found.bytes.length,
        contentType: found.type,
        contentEncoding: undefined,
        contentDisposition: undefined,
        cacheControl: undefined,
        eTag: `"${found.bytes.length}"`,
        lastModified: undefined,
        contentRange: undefined,
      };
    },
    async delete(params: { key: string }) {
      objects.delete(params.key);
    },
  } as unknown as MediaBucket;
  return {
    bucket,
    objects,
    bytesOf: (key: string) => objects.get(key)?.bytes,
  };
}
