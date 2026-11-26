import type { ReadDocumentOf } from "@softistx/mongo";
import type { ObjectId } from "mongodb";
import type { Viewer } from "@/auth/access";
import type { AppMongo } from "@/config/db";
import {
  type CategoriesService,
  type CountriesService,
  countryNotFound,
} from "@/modules/config";
import type { Now } from "@/shared/dates";
import { invalidInput } from "@/shared/errors";
import { toConnection } from "@/shared/pagination";
import {
  extensionLimit,
  invalidStatus,
  listingNotFound,
  locked,
} from "../listings.errors";
import {
  addDays,
  CLOSABLE_STATUSES,
  dayOf,
  dayOfString,
  EDITABLE_STATUSES,
  LISTING_DAYS,
  type ListingContent,
  MAX_EXTENSIONS,
  PUBLIC_STATUSES,
  storedFields,
} from "../listings.utils";
import type { CloseReason, ListingKind, listings } from "../models";
import { contentIssues } from "../rules";
import type { PhotosService } from "./photos.service";

export type ListingDocument = ReadDocumentOf<typeof listings>;

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
  declare(viewer: Viewer, input: DeclareInput, orgId: ObjectId | null) {
    // Locked so that two declarations racing for one photo key meet the unique
    // index (`photos.key`), the loser reading the key as taken.
    return locked(false, async () => {
      const fields = await this.fieldsOf(
        viewer,
        input,
        input.kind,
        null,
        orgId,
      );
      const published = input.publish === true ? this.publishing(fields) : {};
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
    });
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
        listing.orgId,
      );
      const removed = listing.photos
        .map((photo) => photo.key)
        .filter((key) => !content.photoKeys.includes(key));
      const publishing =
        publish === true && listing.status === "DRAFT"
          ? this.publishing(fields)
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

  // What publishing sets: a listing with photos to settle is pending until
  // they are (the job opens it); one without, or an ID document's (whose photos
  // are held back for the blur slice and never served), opens at once. 90 days
  // from now.
  private publishing(fields: {
    photos: unknown[];
    documentType: string | null;
  }) {
    const now = this.deps.now();
    const waiting = fields.photos.length > 0 && fields.documentType === null;
    return {
      status: waiting ? ("PENDING" as const) : ("OPEN" as const),
      publishedAt: now,
      expiresAt: addDays(now, LISTING_DAYS),
    };
  }

  // Starts the photo job for a published listing that waits for it. A draft is
  // private: its photos settle when it is published.
  private settleLater(listing: ListingDocument) {
    const waiting = listing.status === "PENDING";
    const photos =
      listing.status !== "DRAFT" &&
      listing.documentType === null &&
      listing.photos.some((photo) => photo.status === "PENDING");
    if (!waiting && !photos) return;
    const id = listing._id.toHexString();
    this.deps.background.run("listing photos", () =>
      this.deps.photos.settleWithRetry(id),
    );
  }

  // The stored fields of a content, once checked: one `invalid-input` with
  // every issue when it is not. `current` is the listing being replaced, whose
  // own photos stay attachable; `orgId` its organisation's register, if any.
  private async fieldsOf(
    viewer: Viewer,
    content: ListingContent,
    kind: ListingKind,
    current: ListingDocument | null,
    orgId: ObjectId | null,
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
        inRegister: orgId !== null,
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
    return storedFields(
      content,
      new Map(current?.photos.map((p) => [p.key, p.status])),
    );
  }

  // The keys the viewer uploaded that no other listing carries.
  private async freeKeys(
    viewer: Viewer,
    keys: readonly string[],
    current: ListingDocument | null,
  ) {
    if (keys.length === 0) return new Set<string>();
    // The listing's own photos stay attachable to whoever edits it (its
    // author, or an agent of its organisation); a new key must be the
    // editor's own upload.
    const own = new Set(current?.photos.map((photo) => photo.key));
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
    return new Set([
      ...own,
      ...uploads.map((upload) => upload._id).filter((key) => !taken.has(key)),
    ]);
  }
}
