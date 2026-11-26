import type { ObjectId } from "mongodb";
import type { AppMongo } from "@/config/db";
import type { ListingDocument } from "@/modules/listings";
import type { Now } from "@/shared/dates";
import { invalidInput } from "@/shared/errors";
import { toConnection } from "@/shared/pagination";
import type { ListingRanker } from "../search.ranking";
import { filterIssues } from "../search.rules";
import {
  decodeCursor,
  distanceFrom,
  encodeCursor,
  MAX_DEPTH,
  matchOf,
  NEAR_SCAN,
  type SearchFilter,
} from "../search.utils";

export type Order = "RELEVANCE" | "DATE" | "DISTANCE";

// A page of a search, with what its fields need: the filter (for `counts`) and
// each listing's distance from `near`.
export interface SearchPage {
  edges: { node: ListingDocument; distanceM: number | null }[];
  pageInfo: ReturnType<typeof toConnection>["pageInfo"];
  totalCount: number;
  filter: SearchFilter;
}

export interface SearchDeps {
  now: Now;
  ranker: ListingRanker;
}

interface Row {
  id: ObjectId;
  distanceM: number | null;
}

// Search over the open listings (spec §5.4), public: it reads the derived
// fields of the listings collection (`searchText`, `cityKey`, `geo`), which
// hold nothing the masked view does not show, and returns the documents for
// the masked resolvers. Pages are an offset in an opaque cursor, capped at
// `MAX_DEPTH` results.
export class SearchService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly deps: SearchDeps,
  ) {}

  async search(
    filter: SearchFilter,
    page: { first: number; after: string | null | undefined },
    order: Order,
  ): Promise<SearchPage> {
    const issues = filterIssues(filter);
    const offset = decodeCursor(page.after);
    if (offset === undefined) {
      issues.push({ path: "after", code: "validation.errors.invalid" });
    }
    if (issues.length > 0 || offset === undefined) throw invalidInput(issues);
    const match = matchOf(filter, this.deps.now());
    const room = Math.max(0, Math.min(page.first, MAX_DEPTH - offset));
    const [found, total] = await Promise.all([
      this.rows(filter, match, order, offset, room),
      this.mongo.db.listings.raw.countDocuments(match),
    ]);
    const documents = await this.load(found.rows.map((row) => row.id));
    const distances = new Map(
      found.rows.map((row) => [row.id.toHexString(), row.distanceM]),
    );
    const connection = toConnection(
      page.after,
      {
        items: documents,
        nextCursor: found.more ? encodeCursor(offset + room) : null,
      },
      total,
    );
    return {
      edges: connection.edges.map(({ node }) => ({
        node,
        distanceM: distances.get(node._id.toHexString()) ?? null,
      })),
      pageInfo: connection.pageInfo,
      totalCount: total,
      filter,
    };
  }

  // The listings per kind and per category, each over the filter without that
  // field, for the chips.
  async counts(filter: SearchFilter) {
    const group = (without: "kind" | "categoryKey") =>
      this.mongo.db.listings.raw
        .aggregate<{ _id: string; count: number }>([
          { $match: matchOf(filter, this.deps.now(), without) },
          { $group: { _id: `$${without}`, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
        ])
        .toArray();
    const [kinds, categories] = await Promise.all([
      group("kind"),
      group("categoryKey"),
    ]);
    return {
      kinds: kinds.map((row) => ({
        kind: row._id as "LOST" | "FOUND",
        count: row.count,
      })),
      categories: categories.map((row) => ({
        categoryKey: row._id,
        count: row.count,
      })),
    };
  }

  // The ids of one page, in order, with their distance from `near` when the
  // filter has one, and whether more follow within the cap.
  private async rows(
    filter: SearchFilter,
    match: Record<string, unknown>,
    order: Order,
    offset: number,
    room: number,
  ) {
    const { near } = filter;
    const listings = this.mongo.db.listings.raw;
    const distanceOf = (geo: { coordinates: [number, number] } | null) =>
      near && geo ? distanceFrom(near, geo) : null;
    const newestDay = { date: -1, _id: -1 } as const;
    const window = (rows: Row[]) => ({
      rows: rows.slice(offset, offset + room),
      more: rows.length > offset + room && offset + room < MAX_DEPTH,
    });
    if (order === "RELEVANCE" && filter.text) {
      const scored = await listings
        .find(match, { projection: { geo: 1, score: { $meta: "textScore" } } })
        .sort({ score: { $meta: "textScore" }, ...newestDay })
        .limit(MAX_DEPTH)
        .toArray();
      const ranked = await this.deps.ranker.rank(
        { text: filter.text },
        scored.map((doc) => ({
          id: doc._id,
          textScore: Number((doc as { score?: unknown }).score ?? 0),
        })),
      );
      const geos = new Map(
        scored.map((doc) => [doc._id.toHexString(), doc.geo]),
      );
      return window(
        ranked.map(({ id }) => ({
          id,
          distanceM: distanceOf(geos.get(id.toHexString()) ?? null),
        })),
      );
    }
    if (order === "DISTANCE" && near) {
      const scanned = await listings
        .find(match, { projection: { geo: 1 } })
        .sort(newestDay)
        .limit(NEAR_SCAN)
        .toArray();
      return window(
        scanned
          .map((doc) => ({ id: doc._id, distanceM: distanceOf(doc.geo) }))
          .sort(
            (a, b) =>
              (a.distanceM ?? 0) - (b.distanceM ?? 0) ||
              b.id.toHexString().localeCompare(a.id.toHexString()),
          ),
      );
    }
    const dated = await listings
      .find(match, { projection: { geo: 1 } })
      .sort(newestDay)
      .skip(offset)
      .limit(room + 1)
      .toArray();
    return {
      rows: dated
        .slice(0, room)
        .map((doc) => ({ id: doc._id, distanceM: distanceOf(doc.geo) })),
      more: dated.length > room && offset + room < MAX_DEPTH,
    };
  }

  // The documents of `ids`, in that order (one closed, removed or expired since the first read is dropped).
  private async load(ids: readonly ObjectId[]) {
    if (ids.length === 0) return [];
    const found = await this.mongo.db.listings.findMany({
      filter: {
        _id: { $in: [...ids] },
        status: "OPEN",
        expiresAt: { $gt: this.deps.now() },
      },
    });
    const byId = new Map(found.map((doc) => [doc._id.toHexString(), doc]));
    return ids.flatMap((id) => byId.get(id.toHexString()) ?? []);
  }
}
