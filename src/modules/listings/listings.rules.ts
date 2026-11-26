import type { FieldIssue } from "@/shared/errors";
import type { KeptAt, ListingKind } from "./models";

export const MIN_RADIUS_M = 200;
export const MAX_RADIUS_M = 20_000;
export const MAX_PHOTOS = 5;

export interface ContentRulesInput {
  kind: ListingKind;
  categoryKey: string;
  documentType: string | null | undefined;
  date: Date;
  radiusM: number | null | undefined;
  keptAt: KeptAt | null | undefined;
  questionCount: number;
  photoKeys: readonly string[];
}

export interface RulesLookups {
  // The live root category the key names, or undefined.
  category: { isDocument: boolean } | undefined;
  // The country's document types, or undefined for a country not active.
  documentTypes: readonly string[] | undefined;
  today: Date;
  // The keys the author uploaded and no listing carries yet.
  free: ReadonlySet<string>;
}

const issue = (
  path: string,
  code: FieldIssue["code"],
  params?: FieldIssue["params"],
): FieldIssue => ({ path, code, ...(params && { params }) });

// The issues of a listing's content, each on its path. Pure: the lookups (the
// category, the country's document types, what the author uploaded) are given.
export function contentIssues(
  input: ContentRulesInput,
  lookups: RulesLookups,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const { category } = lookups;
  if (category === undefined) {
    issues.push(
      issue("categoryKey", "listings.errors.category-invalid", {
        key: input.categoryKey,
      }),
    );
  } else {
    const given = input.documentType ?? null;
    if (category.isDocument && given === null) {
      issues.push(
        issue("documentType", "listings.errors.document-type-invalid", {
          reason: "required",
        }),
      );
    } else if (!category.isDocument && given !== null) {
      issues.push(
        issue("documentType", "listings.errors.document-type-invalid", {
          reason: "unexpected",
        }),
      );
    } else if (given !== null && !lookups.documentTypes?.includes(given)) {
      issues.push(
        issue("documentType", "listings.errors.document-type-invalid", {
          reason: "unknown",
        }),
      );
    }
  }
  if (input.date.getTime() > lookups.today.getTime()) {
    issues.push(issue("date", "validation.errors.out-of-range"));
  }
  issues.push(...kindIssues(input));
  issues.push(...photoIssues(input.photoKeys, lookups.free));
  return issues;
}

// A lost item has an area and no question; a found one has a whereabouts and
// one to three questions.
function kindIssues(input: ContentRulesInput): FieldIssue[] {
  if (input.kind === "LOST") {
    const radius = input.radiusM;
    return [
      ...(radius === null || radius === undefined
        ? [issue("place.radiusM", "validation.errors.required")]
        : radius < MIN_RADIUS_M || radius > MAX_RADIUS_M
          ? [
              issue("place.radiusM", "validation.errors.out-of-range", {
                min: MIN_RADIUS_M,
                max: MAX_RADIUS_M,
              }),
            ]
          : []),
      ...(input.keptAt
        ? [issue("place.keptAt", "validation.errors.invalid")]
        : []),
      ...(input.questionCount > 0
        ? [issue("questions", "validation.errors.too-many", { max: 0 })]
        : []),
    ];
  }
  return [
    ...(input.keptAt
      ? []
      : [issue("place.keptAt", "validation.errors.required")]),
    ...(input.radiusM === null || input.radiusM === undefined
      ? []
      : [issue("place.radiusM", "validation.errors.invalid")]),
    ...(input.questionCount < 1
      ? [issue("questions", "validation.errors.too-few", { min: 1 })]
      : input.questionCount > 3
        ? [issue("questions", "validation.errors.too-many", { max: 3 })]
        : []),
  ];
}

// At most five photos, each uploaded by the author, none repeated and none
// already on a listing.
function photoIssues(
  keys: readonly string[],
  free: ReadonlySet<string>,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (keys.length > MAX_PHOTOS) {
    issues.push(
      issue("photoKeys", "validation.errors.too-many", { max: MAX_PHOTOS }),
    );
  }
  const seen = new Set<string>();
  keys.forEach((key, i) => {
    const reason = seen.has(key)
      ? "duplicate"
      : free.has(key)
        ? undefined
        : "unknown";
    seen.add(key);
    if (reason !== undefined) {
      issues.push(
        issue(`photoKeys.${i}`, "listings.errors.photo-invalid", { reason }),
      );
    }
  });
  return issues;
}
