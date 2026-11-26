import type { IdFields } from "./id-fields.rules";

export const MASK = "•";
// The characters of a number shown in public: the first two (spec §4.2). The
// last ones are what a claim asks for, so they are never shown.
export const SHOWN_CHARACTERS = 2;
// A number shorter than this is masked whole: two characters of it would say
// too much.
const MIN_SHOWN_LENGTH = 6;

// A normalised number with all but its first two characters masked
// (`99••••••••`), its length kept.
export function maskedNumber(number: string): string {
  if (number.length < MIN_SHOWN_LENGTH) return MASK.repeat(number.length);
  return (
    number.slice(0, SHOWN_CHARACTERS) +
    MASK.repeat(number.length - SHOWN_CHARACTERS)
  );
}

const capitalised = (word: string) =>
  word
    .toLowerCase()
    .replace(
      /(^|[-'])(\p{L})/gu,
      (_, mark: string, letter: string) => `${mark}${letter.toUpperCase()}`,
    );

// The holder as the public sees them: their first given name and the initial
// of their last name ("Jean E."). Null without a given name: an initial alone
// says nothing and a surname alone too much.
export function holderHint(fields: Pick<IdFields, "givenNames" | "surname">) {
  const first = fields.givenNames?.trim().split(/\s+/)[0];
  if (first === undefined || first === "") return null;
  const initial = fields.surname?.trim()[0];
  return initial === undefined
    ? capitalised(first)
    : `${capitalised(first)} ${initial.toUpperCase()}.`;
}

// What `listings.public` holds of an ID document's fields.
export const publicIdTextOf = (fields: IdFields) => ({
  maskedNumber: fields.number === null ? null : maskedNumber(fields.number),
  holderHint: holderHint(fields),
});
