import type { ReadDocumentOf } from "@softistx/mongo";
import type { AppMongo } from "@/config/db";
import { invalidInput } from "@/shared/errors";
import { locked } from "../config.errors";
import { countryIssues } from "../config.rules";
import type { countries } from "../models";

export type CountryDocument = ReadDocumentOf<typeof countries>;

export interface CountryInput {
  code: string;
  names: CountryDocument["names"];
  dialCode: string;
  phonePattern: string;
  documentTypes: string[];
  languages: CountryDocument["languages"];
  mapCenter: CountryDocument["mapCenter"];
  mapZoom: number;
  idNumberPatterns: { documentType: string; pattern: string }[];
  active?: boolean | undefined;
}

// The countries the platform serves: global configuration, seeded by a
// migration and edited by the platform admin. Reads leave the inactive ones out
// unless asked.
export class CountriesService {
  constructor(private readonly mongo: AppMongo) {}

  list(includeInactive: boolean) {
    return this.mongo.db.countries.findMany({
      filter: includeInactive ? {} : { active: true },
      sort: { _id: 1 },
    });
  }

  find(code: string) {
    return this.mongo.db.countries.findById(code);
  }

  // A country active under `code`, or undefined: what a safe place's country
  // is checked against.
  async active(code: string) {
    const found = await this.find(code);
    return found?.active ? found : undefined;
  }

  // Makes or replaces the country `code` (stated whole: a field given is the
  // new value). Its document types must be live document categories.
  async set(input: CountryInput) {
    const { code, active = true, ...rest } = input;
    const fields = { ...rest, active };
    const documents = await this.mongo.db.categories.findMany({
      filter: { isDocument: true, active: true },
    });
    const issues = countryIssues(
      rest,
      new Set(documents.map((category) => category._id)),
    );
    if (issues.length > 0) throw invalidInput(issues);
    return locked(false, () =>
      this.mongo.transaction(async (tx) => {
        const existing = await tx.db.countries.findById(code);
        return existing
          ? tx.db.countries.update(code, fields)
          : tx.db.countries.create({ _id: code, ...fields });
      }),
    );
  }
}
