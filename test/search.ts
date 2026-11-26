import { foundContent, type listingsAs, lostContent } from "~/listings";

type Me = Awaited<ReturnType<typeof listingsAs>>;

// The `YYYY-MM-DD` of `n` days ago, UTC.
export const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// A listing published at once (no photo, so it opens), as `me`.
export const publishFound = (
  me: Me,
  over: Parameters<typeof foundContent>[0] = {},
) =>
  me.listings.declare(
    me.viewer,
    { ...foundContent(over), kind: "FOUND", publish: true },
    null,
  );

export const publishLost = (
  me: Me,
  over: Parameters<typeof lostContent>[0] = {},
) =>
  me.listings.declare(
    me.viewer,
    { ...lostContent(over), kind: "LOST", publish: true },
    null,
  );

// A point of Douala (drawn coordinates), moved by `dLat` and `dLon` degrees.
export const douala = (dLat = 0, dLon = 0) => ({
  latitude: 4.05123 + dLat,
  longitude: 9.70456 + dLon,
});
