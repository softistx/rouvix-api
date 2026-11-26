import { join } from "node:path";

// The directory that holds src/ with the SDL files, from the directory of the
// code reading them: `../..` of src/http/ under `bun dev` and `bun test`; for a
// bundle (dist/server.js, dist/scripts/<name>/index.js) the parent of the last
// `dist` segment, where the image copies the SDL files.
export function sdlRoot(dir: string): string {
  const sourceTree = /[\\/]src[\\/]http$/.test(dir);
  const bundled = sourceTree ? null : /^(.*)[\\/]dist(?=[\\/]|$)/.exec(dir);
  return bundled?.[1] !== undefined ? bundled[1] || "/" : join(dir, "..", "..");
}
