import { blurredKeysOf } from "../listings.utils";
import type { ListingPhoto } from "../models";

// What a visitor is shown of a listing's photos: the ready ones, as they are
// for an object's photo the OCR found nothing of an ID in, as their blurred
// copy for an ID document's and any ID-like one. Never a document's own key.
export function publicPhotoKeys(listing: {
  documentType: string | null;
  photos: readonly ListingPhoto[];
}) {
  const ready = listing.photos.filter((photo) => photo.status === "READY");
  return {
    photoKeys:
      listing.documentType === null
        ? ready.filter((p) => p.blurredKey === null).map((p) => p.key)
        : [],
    blurredPhotoKeys: blurredKeysOf(ready),
  };
}

// What clears an ID document's fields: the listing closes, is removed, or its
// photos are processed again.
export const NO_ID_FIELDS = {
  idFields: null,
  idNumberHash: null,
  public: { maskedNumber: null, holderHint: null },
} as const;

// Whether an update makes the listing's photos go through the ID pipeline
// again: its document type changes (an object becomes a document or the other
// way, a CNI a passport), or a document loses a photo its fields were read from.
export const processesAgain = (
  listing: { documentType: string | null },
  content: { documentType?: string | null | undefined },
  removesPhotos: boolean,
) =>
  (content.documentType ?? null) !== listing.documentType ||
  (listing.documentType !== null && removesPhotos);

// The photos a closing listing keeps and those it removes: an ID document's
// all go, an object's ID-like ones (those with a blurred copy) too, and those
// never checked yet (still pending: they could be an ID's).
export function closingPhotos(listing: {
  documentType: string | null;
  photos: readonly ListingPhoto[];
}) {
  const gone = listing.photos.filter(
    (photo) =>
      listing.documentType !== null ||
      photo.blurredKey !== null ||
      photo.status === "PENDING",
  );
  return {
    kept: listing.photos.filter((photo) => !gone.includes(photo)),
    gone,
  };
}
