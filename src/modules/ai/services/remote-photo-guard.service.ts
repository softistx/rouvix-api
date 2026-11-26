import type { CategoriesService, CountriesService } from "@/modules/config";
import { compilePatterns, isIdLike, type Ocr } from "@/ocr";
import type { Now } from "@/shared/dates";
import { aiUnavailable, documentPhoto } from "../ai.errors";

// A photo a remote service would be given: its bytes, the country it is
// declared in, its category when the author chose one, and its media key once
// it is uploaded.
export interface RemotePhoto {
  bytes: Uint8Array;
  countryCode: string;
  categoryKey: string | null;
  key: string | null;
}

export interface RemotePhotoDeps {
  // The local OCR, for the ID-like check: on this machine, never remote.
  ocr: Ocr;
  categories: Pick<CategoriesService, "find">;
  countries: Pick<CountriesService, "active">;
  // Whether a media key is an ID document's photo or one found ID-like.
  idPhoto: (key: string) => Promise<boolean>;
  now: Now;
}

// The gate every call that would send a photo off this machine goes through
// (AGENTS.md: "ID documents never leave the VPS"; spec §4.3), the object
// describer first (`SuggestionsService`): `send` runs the call only for a photo
// that is no ID document's. It refuses with `ai.errors.document-photo` a
// photo of a document category, the key of an ID photo, and a photo the local
// OCR finds ID-like (a zone, a state heading, a document title, a number of
// the country's beside a name); it fails closed with `ai.errors.unavailable`
// when that OCR cannot answer. A refused photo reaches nothing.
export class RemotePhotoGuard {
  constructor(private readonly deps: RemotePhotoDeps) {}

  async send<T>(
    photo: RemotePhoto,
    call: (bytes: Uint8Array) => Promise<T>,
  ): Promise<T> {
    await this.assertNoIdDocument(photo);
    return call(photo.bytes);
  }

  private async assertNoIdDocument(photo: RemotePhoto) {
    if (photo.categoryKey !== null) {
      const category = await this.deps.categories.find(photo.categoryKey);
      if (category?.isDocument === true) throw documentPhoto();
    }
    if (photo.key !== null && (await this.deps.idPhoto(photo.key))) {
      throw documentPhoto();
    }
    // The country's own number patterns are part of the check: a country the
    // platform does not serve would switch them off, so it fails closed.
    const country = await this.deps.countries.active(photo.countryCode);
    if (country === undefined) throw aiUnavailable();
    let text: Awaited<ReturnType<Ocr["read"]>>;
    try {
      text = await this.deps.ocr.read(photo.bytes);
    } catch {
      throw aiUnavailable();
    }
    const patterns = compilePatterns(country.idNumberPatterns, null);
    if (isIdLike(text, patterns, this.deps.now().getUTCFullYear())) {
      throw documentPhoto();
    }
  }
}
