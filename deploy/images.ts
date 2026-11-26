/** The images this app builds, as named in the compose file. */
export const APP_IMAGES = ["rouvix-api"];

/**
 * The image references to remove after a deploy: the references of this app's
 * own repositories that the stack no longer uses. `listing` is `docker image ls
 * --format '{{.Repository}}:{{.Tag}}'`; `current` is `docker compose config
 * --images` (every image the stack runs, whatever TAG says). Anything else
 * (third-party images, `<none>` tags, which `docker image prune` handles) is
 * kept.
 */
export function staleImageRefs(listing: string, current: string[]): string[] {
  const repos = new Set(APP_IMAGES);
  const keep = new Set(current.map((ref) => ref.trim()));
  const refs = new Set<string>();
  for (const line of listing.split("\n")) {
    const ref = line.trim();
    const colon = ref.lastIndexOf(":");
    if (colon <= 0) continue;
    if (!repos.has(ref.slice(0, colon))) continue;
    if (ref.endsWith(":<none>") || keep.has(ref)) continue;
    refs.add(ref);
  }
  return [...refs];
}
