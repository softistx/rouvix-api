import type { Viewer } from "@/auth/access";
import {
  type ObjectDescriber,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from "@/describer";
import type { CategoriesService } from "@/modules/config";
import type { PhotosService } from "@/modules/listings";
import { aiUnavailable, photoNotFound } from "../ai.errors";
import { type Suggestion, suggestionOf } from "../ai.rules";
import type { RemotePhotoGuard } from "./remote-photo-guard.service";
import type { UsageService } from "./usage.service";

export interface SuggestionDeps {
  // The only door a photo takes to Claude.
  guard: Pick<RemotePhotoGuard, "send">;
  describer: ObjectDescriber;
  usage: Pick<UsageService, "claim" | "record">;
  photos: Pick<PhotosService, "uploadedBytes">;
  categories: Pick<CategoriesService, "list">;
}

export interface SuggestInput {
  photoKey: string;
  countryCode: string;
  categoryKey: string | null;
  // `fr` or `en`.
  language: string;
}

export interface ObjectSuggestion extends Suggestion {
  promptVersion: number;
  schemaVersion: number;
}

// `suggestFromPhoto` (spec §4.3, §5.5): the suggestion Claude makes from the
// photo of an object, which the author accepts or edits; nothing is published
// from it. The photo goes through `RemotePhotoGuard` and nowhere else: an ID
// document's, or one that looks like it, is refused before any call, and the
// OCR being down refuses it too. Claude down, or over the day's cap, is
// `ai.errors.unavailable`: the declare form works without a suggestion.
export class SuggestionsService {
  constructor(private readonly deps: SuggestionDeps) {}

  async suggest(
    viewer: Viewer,
    input: SuggestInput,
  ): Promise<ObjectSuggestion> {
    const bytes = await this.deps.photos.uploadedBytes(
      viewer.id,
      input.photoKey,
    );
    if (bytes === undefined) throw photoNotFound();
    const offered = (await this.deps.categories.list(false)).filter(
      (category) => category.parent === null && !category.isDocument,
    );
    const described = await this.deps.guard.send(
      {
        bytes,
        countryCode: input.countryCode,
        categoryKey: input.categoryKey,
        key: input.photoKey,
      },
      (checked) => this.ask(checked, offered, input.language),
    );
    try {
      await this.deps.usage.record(described.usage);
    } catch (error) {
      // The call is made and counted: the tokens missing is no reason to refuse.
      console.error("rouvix-api: Claude's tokens were not counted:", error);
    }
    return {
      ...suggestionOf(
        described.description,
        offered.map((category) => category._id),
      ),
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  // The call, once the guard let the photo through: counted against the cap
  // first, and any failure of Claude is the one `unavailable` answer.
  private async ask(
    bytes: Uint8Array,
    offered: Awaited<ReturnType<CategoriesService["list"]>>,
    language: string,
  ) {
    if (!(await this.deps.usage.claim())) throw aiUnavailable();
    try {
      return await this.deps.describer.describe(
        // The stored rendition of every photo is a WebP (src/modules/listings).
        { bytes, mediaType: "image/webp" },
        {
          language,
          categories: offered.map((category) => ({
            key: category._id,
            label: language === "en" ? category.labels.en : category.labels.fr,
          })),
        },
      );
    } catch (error) {
      console.error(
        `rouvix-api: Claude gave no suggestion: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
      throw aiUnavailable();
    }
  }
}
