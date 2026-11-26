import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A PNG of a colour gradient, `width` x `height`, built by hand. */
export function pngOf(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      rows[at + 1 + x * 3] = (x * 255) / width;
      rows[at + 2 + x * 3] = (y * 255) / height;
      rows[at + 3 + x * 3] = 128;
    }
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array(0)),
  ];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

/** A JPEG of the same gradient. */
export async function jpegOf(width: number, height: number) {
  return new Bun.Image(pngOf(width, height)).jpeg().bytes();
}

/**
 * The JPEG with two APP1 segments right after SOI: an EXIF one (orientation 6,
 * and a GPS-looking tag name) and an XMP one, as a phone writes them.
 */
export async function jpegWithMetadata(width: number, height: number) {
  const jpeg = await jpegOf(width, height);
  const text = (s: string) => new TextEncoder().encode(s);
  // TIFF header (little endian), one IFD entry: Orientation (0x0112) = 6.
  const tiff = Uint8Array.from([
    0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0,
    0, 0, 0, 0, 0, 0,
  ]);
  const segment = (payload: Uint8Array) => {
    const out = new Uint8Array(4 + payload.length);
    out.set([
      0xff,
      0xe1,
      (payload.length + 2) >> 8,
      (payload.length + 2) & 255,
    ]);
    out.set(payload, 4);
    return out;
  };
  const exif = segment(Uint8Array.from([...text("Exif\0\0"), ...tiff]));
  const xmp = segment(
    text(
      "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret-location</x:xmpmeta>",
    ),
  );
  return Uint8Array.from([
    ...jpeg.subarray(0, 2),
    ...exif,
    ...xmp,
    ...jpeg.subarray(2),
  ]);
}

/** The fourcc of every chunk of a RIFF/WebP file, in order. */
export function webpChunks(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const out: string[] = [];
  for (let at = 12; at + 8 <= bytes.length; ) {
    out.push(new TextDecoder().decode(bytes.subarray(at, at + 4)));
    at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2);
  }
  return out;
}

/**
 * A drawn card, `width` x `height`: a pale ground with rows of black and white
 * bars like lines of print, all sharp edges. Nobody's document: a pattern.
 */
export function drawnCardPng(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const printed = Math.floor(y / 12) % 2 === 1;
    for (let x = 0; x < width; x++) {
      rows[y * (1 + width) + 1 + x] =
        printed && Math.floor(x / 3) % 2 === 0 ? 10 : 235;
    }
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array(0)),
  ];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}
