import { createHash } from "node:crypto";
import type { RawDescription } from "@/describer";

// The pure rules of the AI pipeline: what a suggestion is cleaned to, the text
// a listing is embedded from, and the maths of the re-ranking. No port, no
// clock, no database.

// The limits of a listing's own fields (listings.model.ts): a suggestion that
// the author accepts as it is must pass the declare form's checks.
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 600;
export const COLOURS_MAX = 5;
export const COLOUR_MAX = 30;
export const BRAND_MAX = 60;
export const MARKS_MAX = 300;

// What the model said is UNTRUSTED text: it may carry markup, a link or a line
// meant for a reader or another program. It leaves here as plain words only:
// control characters, `<` and `>` and links removed, spaces collapsed, cut.
export function cleanText(text: string, max: number): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[\p{Cc}\p{Cf}<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

const orNull = (text: string | null, max: number): string | null => {
  const clean = text === null ? "" : cleanText(text, max);
  return clean === "" ? null : clean;
};

// A suggestion as the API returns it: the model's raw answer bounded to what a
// listing stores, its category kept only when it is one it was offered.
export interface Suggestion {
  categoryKey: string | null;
  title: string;
  description: string;
  attributes: {
    colours: string[];
    brand: string | null;
    marks: string | null;
  };
}

export function suggestionOf(
  raw: RawDescription,
  offered: readonly string[],
): Suggestion {
  const colours = [
    ...new Set(
      raw.colours
        .map((colour) => cleanText(colour, COLOUR_MAX))
        .filter((colour) => colour !== ""),
    ),
  ].slice(0, COLOURS_MAX);
  return {
    categoryKey:
      raw.category !== null && offered.includes(raw.category)
        ? raw.category
        : null,
    title: cleanText(raw.title, TITLE_MAX),
    description: cleanText(raw.description, DESCRIPTION_MAX),
    attributes: {
      colours,
      brand: orNull(raw.brand, BRAND_MAX),
      marks: orNull(raw.marks, MARKS_MAX),
    },
  };
}

// What a listing is embedded from (spec §4.4): its title, description and
// attributes, never an ID document's, which nothing embeds: null for one.
export interface EmbeddableListing {
  documentType: string | null;
  title: string;
  description: string;
  attributes: {
    colours: readonly string[];
    brand: string | null;
    marks: string | null;
  };
}

export function embeddingTextOf(listing: EmbeddableListing): string | null {
  if (listing.documentType !== null) return null;
  const { colours, brand, marks } = listing.attributes;
  return [
    listing.title,
    listing.description,
    colours.length > 0 ? colours.join(", ") : "",
    brand ?? "",
    marks ?? "",
  ]
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, 2_000);
}

// What a stored vector is tied to: the text it came from, as a hash, so a
// listing whose text did not change is not embedded again.
export const textHashOf = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

// The weight of the meaning of a text against its words, once both are on one
// scale: the text score divided by the best of the candidates', the cosine as
// it is. A candidate with no vector counts for its words alone.
export const SEMANTIC_WEIGHT = 0.6;

export function blendedScore(
  textScore: number,
  bestTextScore: number,
  similarity: number | null,
): number {
  const words = bestTextScore > 0 ? textScore / bestTextScore : 0;
  if (similarity === null) return (1 - SEMANTIC_WEIGHT) * words;
  return (1 - SEMANTIC_WEIGHT) * words + SEMANTIC_WEIGHT * similarity;
}
