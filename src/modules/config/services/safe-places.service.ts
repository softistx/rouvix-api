import type { ReadDocumentOf } from "@softistx/mongo";
import type { ObjectId } from "mongodb";
import type { AppMongo } from "@/config/db";
import { toConnection } from "@/shared/pagination";
import { countryNotFound, locked, safePlaceNotFound } from "../config.errors";
import {
  distanceM,
  fromGeoJson,
  type GeoPoint,
  toGeoJson,
} from "../config.utils";
import type { SafePlaceKind, safePlaces } from "../models";
import type { CountriesService } from "./countries.service";

export type SafePlaceDocument = ReadDocumentOf<typeof safePlaces>;

export interface SafePlaceInput {
  countryCode: string;
  city: string;
  name: string;
  kind: SafePlaceKind;
  location: GeoPoint;
  hours: string | null;
}

// The places an item can be handed over at: police stations (seeded) and,
// later, partner organisations. Global configuration, edited by the platform
// admin; an archived place is out of every read.
export class SafePlacesService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly countries: Pick<CountriesService, "active">,
  ) {}

  async list(
    filter: {
      countryCode?: string | null | undefined;
      city?: string | null | undefined;
    },
    page: { first: number; after: string | null | undefined },
  ) {
    const where = {
      ...(filter.countryCode && { countryCode: filter.countryCode }),
      ...(filter.city && { city: filter.city }),
    };
    const places = this.mongo.db.safePlaces;
    const [items, total] = await Promise.all([
      places.paginateByCursor({
        filter: where,
        limit: page.first,
        after: page.after ?? null,
        orderBy: "city",
        direction: "asc",
      }),
      places.count(where),
    ]);
    return toConnection(page.after, items, total);
  }

  // The places within `radiusM` of `point`, nearest first, each with its
  // distance in metres: MongoDB's 2dsphere index orders them.
  async near(
    point: GeoPoint,
    options: {
      radiusM: number;
      first: number;
      countryCode?: string | null | undefined;
    },
  ) {
    const found = await this.mongo.db.safePlaces.findMany({
      filter: {
        ...(options.countryCode && { countryCode: options.countryCode }),
        location: {
          $nearSphere: {
            $geometry: toGeoJson(point),
            $maxDistance: options.radiusM,
          },
        },
      },
      limit: options.first,
    });
    return found.map((place) => ({
      place,
      distanceM: distanceM(point, fromGeoJson(place.location)),
    }));
  }

  async create(input: SafePlaceInput) {
    await this.assertCountry(input.countryCode);
    return this.mongo.db.safePlaces.create(this.fieldsOf(input));
  }

  // Replaces the place's fields (stated whole). With `version`, someone else's
  // write first is the 409 `stale-version`.
  async update(id: ObjectId, input: SafePlaceInput, version?: number | null) {
    await this.assertCountry(input.countryCode);
    return locked(typeof version === "number", async () => {
      const found = await this.mongo.db.safePlaces.findById(id);
      if (!found) throw safePlaceNotFound();
      return this.mongo.db.safePlaces.update(id, {
        ...this.fieldsOf(input),
        ...(typeof version === "number" && { version }),
      });
    });
  }

  // Archives the place and answers its id.
  async remove(id: ObjectId) {
    if (!(await this.mongo.db.safePlaces.findById(id))) {
      throw safePlaceNotFound();
    }
    await this.mongo.db.safePlaces.delete(id);
    return id.toHexString();
  }

  private async assertCountry(code: string) {
    if (!(await this.countries.active(code))) throw countryNotFound(code);
  }

  private fieldsOf(input: SafePlaceInput) {
    const { location, ...rest } = input;
    return { ...rest, location: toGeoJson(location) };
  }
}
