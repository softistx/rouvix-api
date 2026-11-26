export type Params = Record<string, string | number>;

// The parameters whose messages type them as dates (`{day, date, long}`):
// `extensions.params` carry them raw, as YYYY-MM-DD, and ICU formats a Date.
// coverage.spec.ts requires every date argument of a message to be listed.
export const dateParams: ReadonlySet<string> = new Set([
  "date",
  "day",
  "expiresAt",
]);

const day = /^(\d{4})-(\d{2})-(\d{2})$/;

// The day a YYYY-MM-DD names, as the Date that formats as that day in any time
// zone (local midnight), or the value as it is when it names none.
function dayOf(value: string | number): string | number | Date {
  const match = typeof value === "string" ? day.exec(value) : null;
  if (match === null) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// What a message is formatted with: the params, with the dates as Dates.
export function formatted(
  params: Params | undefined,
): Record<string, string | number | Date> | undefined {
  if (params === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      dateParams.has(name) ? dayOf(value) : value,
    ]),
  );
}
