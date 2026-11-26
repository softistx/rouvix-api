import { inflateSync } from "node:zlib";

// The pixels of a PNG, for specs that measure a picture: 8-bit grey, grey and
// alpha, RGB or RGBA, not interlaced (what Bun.Image encodes). Each row is
// unfiltered; `at(x, y)` is the pixel's first channel... `grey(x, y)` its mean.
export function decodePng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("unsupported PNG");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[
        body[9] ?? -1
      ] as number;
    }
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const byte = raw[y * (stride + 1) + 1 + x] as number;
      const left =
        x >= channels ? (pixels[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0;
      const corner =
        y > 0 && x >= channels
          ? (pixels[(y - 1) * stride + x - channels] as number)
          : 0;
      const p = left + up - corner;
      const paeth =
        Math.abs(p - left) <= Math.abs(p - up) &&
        Math.abs(p - left) <= Math.abs(p - corner)
          ? left
          : Math.abs(p - up) <= Math.abs(p - corner)
            ? up
            : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][
        filter ?? 0
      ] as number;
      pixels[y * stride + x] = (byte + predicted) & 255;
    }
  }
  const colours = Math.min(channels, 3);
  const grey = (x: number, y: number) => {
    let sum = 0;
    for (let c = 0; c < colours; c++) {
      sum += pixels[y * stride + x * channels + c] as number;
    }
    return sum / colours;
  };
  return { width, height, channels, grey };
}

// How sharp a picture is: the mean grey difference between neighbours on a
// row. Text and edges make it high; a strong blur makes it close to 0.
export function sharpness(png: ReturnType<typeof decodePng>) {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 1; x < png.width; x++) {
      sum += Math.abs(png.grey(x, y) - png.grey(x - 1, y));
      count += 1;
    }
  }
  return sum / count;
}
