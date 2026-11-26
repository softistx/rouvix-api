import type { ReadDocumentOf } from "@softistx/mongo";
import type { ObjectId } from "mongodb";
import type { Viewer } from "@/auth/access";
import type { AppMongo } from "@/config/db";
import type { Now } from "@/shared/dates";
import { invalidInput } from "@/shared/errors";
import { toConnection } from "@/shared/pagination";
import type { CategoriesService, CountriesService } from "../../config";
import { countryNotFound } from "../../config/config.errors";
import { type GeoPoint, toGeoJson } from "../../config/config.utils";
import {
  extensionLimit,
  invalidStatus,
  listingNotFound,
  locked,
} from "../listings.errors";
import { contentIssues } from "../listings.rules";
import {
  addDays,
  CLOSABLE_STATUSES,
  dayOf,
  dayOfString,
  EDITABLE_STATUSES,
  LISTING_DAYS,
  MAX_EXTENSIONS,
  PUBLIC_STATUSES,
} from "../listings.utils";
import type { CloseReason, KeptAt, ListingKind, listings } from "../models";
import type { PhotosService } from "./photos.service";

export type ListingDocument = ReadDocumentOf<typeof listings>;

// What an author states of a listing (stated whole on an update).
export interface ListingContent {
  countryCode: string;
  categoryKey: string;
  documentType?: string | null | undefined;
  title: string;
  description?: string | null | undefined;
  attributes: {
    colours: string[];
    brand?: string | null | undefined;
    marks?: string | null | undefined;
  };
  photoKeys: string[];
  place: {
    label: string;
    point: GeoPoint;
    radiusM?: number | null | undefined;
    keptAt?: KeptAt | null | undefined;
  };
  // `YYYY-MM-DD`, the Date scalar.
  date: string;
  questions: { prompt: string; answer: string }[];
}

export interface DeclareInput extends ListingContent {
  kind: ListingKind;
  publish?: boolean | undefined;
}

export interface ListingDeps {
  countries: Pick<CountriesService, "active">;
  categories: Pick<CategoriesService, "find">;
  photos: PhotosService;
  now: Now;
  // Runs what nobody waits for after the answer (the photo job).
  background: { run(name: string, task: () => Promise<unknown>): void };
}

// The listings: the declaration of a lost or a found item (spec §5.3). Writes
// lock on the version; the content is checked by the pure rules over what this
// service looks up (the category, the country, the photos the author uploaded).
// Who may edit is the guard's (`requireListingEditor`), asked before any call
// here that changes a listing.
export class ListingsService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly deps: ListingDeps,
  ) {}

  find(id: string) {
    return this.mongo.db.listings.findById(id);
  }

  // A listing that was not taken down: what its author reads and edits.
  async findLive(id: string) {
    const listing = await this.find(id);
    return listing?.status === "REMOVED" ? undefined : listing;
  }

  // A listing a visitor may read: open or claimed.
  async publicById(id: string) {
    const listing = await this.find(id);
    if (!listing || !PUBLIC_STATUSES.includes(listing.status)) {
      throw listingNotFound();
    }
    return listing;
  }

  async mine(
    viewer: Viewer,
    page: { first: number; after: string | null | undefined },
  ) {
    const filter = { authorId: viewer.id, status: { $ne: "REMOVED" as const } };
    const [items, total] = await Promise.all([
      this.mongo.db.listings.paginateByCursor({
        filter,
        limit: page.first,
        after: page.after ?? null,
        orderBy: "createdAt",
        direction: "desc",
      }),
      this.mongo.db.listings.count(filter),
    ]);
    return toConnection(page.after, items, total);
  }

  // Declares a listing, a draft or published at once. `orgId` is the
  // organisation's register the viewer is an agent of (the resolver's guard).
  async declare(viewer: Viewer, input: DeclareInput, orgId: ObjectId | null) {
    const fields = await this.fieldsOf(viewer, input, input.kind, null);
    const published =
      input.publish === true ? this.publishing(fields.photos.length) : {};
    const created = await this.mongo.as(viewer.id).db.listings.create({
      kind: input.kind,
      authorId: viewer.id,
      orgId,
      status: "DRAFT",
      ...fields,
      ...published,
    });
    this.settleLater(created);
    return created;
  }

  // Replaces the listing's content (stated whole), under `version`; `publish`
  // takes a draft public. Only a draft, a pending or an open listing changes.
  update(
    viewer: Viewer,
    id: string,
    content: ListingContent,
    version: number,
    publish: boolean | undefined,
  ) {
    return locked(true, async () => {
      const listing = await this.reread(id);
      this.assertStatus(listing, EDITABLE_STATUSES);
      const fields = await this.fieldsOf(
        viewer,
        content,
        listing.kind,
        listing,
      );
      const removed = listing.photos
        .map((photo) => photo.key)
        .filter((key) => !content.photoKeys.includes(key));
      const publishing =
        publish === true && listing.status === "DRAFT"
          ? this.publishing(fields.photos.length)
          : {};
      const written = await this.mongo.as(viewer.id).db.listings.update(id, {
        ...fields,
        ...publishing,
        version,
      });
      await this.deps.photos.discard(removed);
      this.settleLater(written);
      return written;
    });
  }

  // Adds 90 days to an open listing, three times at most.
  extend(viewer: Viewer, id: string) {
    return locked(false, async () => {
      const listing = await this.reread(id);
      this.assertStatus(listing, ["OPEN"]);
      if (listing.extendedCount >= MAX_EXTENSIONS) {
        throw extensionLimit(MAX_EXTENSIONS);
      }
      return this.mongo.as(viewer.id).db.listings.update(id, {
        expiresAt: addDays(listing.expiresAt ?? this.deps.now(), LISTING_DAYS),
        extendedCount: listing.extendedCount + 1,
        version: listing.version,
      });
    });
  }

  // Closes the listing for a reason. A document's photos are removed with it
  // (spec §4.2): the ID image does not outlive the listing.
  close(viewer: Viewer, id: string, reason: CloseReason) {
    return locked(false, async () => {
      const listing = await this.reread(id);
      this.assertStatus(listing, CLOSABLE_STATUSES);
      const closed = await this.mongo.as(viewer.id).db.listings.update(id, {
        status: "CLOSED",
        closedReason: reason,
        closedAt: this.deps.now(),
        ...(listing.documentType !== null && { photos: [] }),
        version: listing.version,
      });
      if (listing.documentType !== null) {
        await this.deps.photos.discard(
          listing.photos.map((photo) => photo.key),
        );
      }
      return closed;
    });
  }

  // Takes the listing down for good: out of every read, its photos removed.
  remove(viewer: Viewer, id: string) {
    return locked(false, async () => {
      const listing = await this.reread(id);
      if (listing.status === "REMOVED") throw listingNotFound();
      await this.mongo.as(viewer.id).db.listings.update(id, {
        status: "REMOVED",
        photos: [],
        version: listing.version,
      });
      await this.deps.photos.discard(listing.photos.map((photo) => photo.key));
      return id;
    });
  }

  private async reread(id: string) {
    const listing = await this.find(id);
    if (listing === undefined) throw listingNotFound();
    return listing;
  }

  private assertStatus(
    listing: ListingDocument,
    allowed: readonly ListingDocument["status"][],
  ) {
    if (!allowed.includes(listing.status)) throw invalidStatus(listing.status);
  }

  // What publishing sets: open at once without photos, pending until they are
  // settled with them; 90 days from now.
  private publishing(photoCount: number) {
    const now = this.deps.now();
    return {
      status: photoCount === 0 ? ("OPEN" as const) : ("PENDING" as const),
      publishedAt: now,
      expiresAt: addDays(now, LISTING_DAYS),
    };
  }

  private settleLater(listing: ListingDocument) {
    // A draft is private: its photos settle when it is published.
    if (listing.status === "DRAFT") return;
    if (!listing.photos.some((photo) => photo.status === "PENDING")) return;
    const id = listing._id.toHexString();
    this.deps.background.run("listing photos", () =>
      this.deps.photos.settle(id),
    );
  }

  // The stored fields of a content, once checked: one `invalid-input` with
  // every issue when it is not. `current` is the listing being replaced, whose
  // own photos stay attachable.
  private async fieldsOf(
    viewer: Viewer,
    content: ListingContent,
    kind: ListingKind,
    current: ListingDocument | null,
  ) {
    const country = await this.deps.countries.active(content.countryCode);
    if (!country) throw countryNotFound(content.countryCode);
    const category = await this.deps.categories.find(content.categoryKey);
    const free = await this.freeKeys(viewer, content.photoKeys, current);
    const issues = contentIssues(
      {
        kind,
        categoryKey: content.categoryKey,
        documentType: content.documentType,
        date: dayOfString(content.date),
        radiusM: content.place.radiusM,
        keptAt: content.place.keptAt,
        questionCount: content.questions.length,
        photoKeys: content.photoKeys,
      },
      {
        category:
          category?.active && category.parent === null ? category : undefined,
        documentTypes: country.documentTypes,
        today: dayOf(this.deps.now()),
        free,
      },
    );
    if (issues.length > 0) throw invalidInput(issues);
    const known = new Map(current?.photos.map((p) => [p.key, p.status]));
    return {
      countryCode: content.countryCode,
      categoryKey: content.categoryKey,
      documentType: content.documentType ?? null,
      title: content.title,
      description: content.description ?? "",
      attributes: {
        colours: content.attributes.colours,
        brand: content.attributes.brand ?? null,
        marks: content.attributes.marks ?? null,
      },
      photos: content.photoKeys.map((key) => ({
        key,
        status: known.get(key) ?? ("PENDING" as const),
      })),
      place: {
        label: content.place.label,
        point: toGeoJson(content.place.point),
        radiusM: content.place.radiusM ?? null,
        keptAt: content.place.keptAt ?? null,
      },
      date: dayOfString(content.date),
      questions: content.questions,
    };
  }

  // The keys the viewer uploaded that no other listing carries.
  private async freeKeys(
    viewer: Viewer,
    keys: readonly string[],
    current: ListingDocument | null,
  ) {
    if (keys.length === 0) return new Set<string>();
    const [uploads, attached] = await Promise.all([
      this.mongo.db.listingUploads.findMany({
        filter: { _id: { $in: [...keys] }, accountId: viewer.id },
      }),
      this.mongo.db.listings.findMany({
        filter: {
          "photos.key": { $in: [...keys] },
          ...(current && { _id: { $ne: current._id } }),
        },
      }),
    ]);
    const taken = new Set(attached.flatMap((l) => l.photos.map((p) => p.key)));
    return new Set(
      uploads.map((upload) => upload._id).filter((key) => !taken.has(key)),
    );
  }
}
