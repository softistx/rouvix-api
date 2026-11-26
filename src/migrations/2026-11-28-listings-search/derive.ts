// What search reads of a listing, derived from its content. A migration imports
// nothing from `src/modules/`, so these are the rules of listings.utils.ts
// (`searchTextOf`, `cityKeyOf`, `searchPoint`) as they were when this migration
// was written; a spec holds the two in step.
interface Source {
  title?: string;
  description?: string;
  documentType?: string | null;
  attributes?: {
    colours?: string[];
    brand?: string | null;
    marks?: string | null;
  };
  place?: {
    point?: { coordinates: [number, number] };
    keptAt?: string | null;
    city?: string | null;
  };
}

const round3 = (value: number) => Number(value.toFixed(3));
const snap = (value: number) => round3(Math.round(value / 0.002) * 0.002);

export function derive(doc: Source) {
  const text = doc.documentType
    ? doc.documentType
    : [
        doc.title,
        doc.description,
        doc.attributes?.brand,
        doc.attributes?.marks,
        ...(doc.attributes?.colours ?? []),
      ]
        .filter((part): part is string => !!part)
        .join(" ");
  const cityKey =
    (doc.place?.city ?? "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim() || null;
  const coordinates = doc.place?.point?.coordinates;
  const publicPlace =
    doc.place?.keptAt === "AT_POLICE" ||
    doc.place?.keptAt === "AT_ORGANISATION";
  const geo = coordinates
    ? {
        type: "Point" as const,
        coordinates: publicPlace
          ? coordinates
          : ([snap(round3(coordinates[0])), snap(round3(coordinates[1]))] as [
              number,
              number,
            ]),
      }
    : null;
  return { searchText: text, cityKey, geo };
}
