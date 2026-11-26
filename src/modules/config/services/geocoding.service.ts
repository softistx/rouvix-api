import { type GeocodePoint, type Geocoder, GeocoderError } from "@/geocoder";
import { geocodingUnavailable } from "../config.errors";

// Place search and reverse geocoding, through the `Geocoder` port. A provider
// that does not answer is the 503 `config.errors.geocoding-unavailable`: the
// declare form works without it.
export class GeocodingService {
  constructor(private readonly geocoder: Geocoder) {}

  search(
    query: string,
    options: { countryCode?: string | null | undefined; limit: number },
  ) {
    return this.guarded(() =>
      this.geocoder.search(query.trim(), {
        countryCode: options.countryCode ?? undefined,
        limit: options.limit,
      }),
    );
  }

  reverse(point: GeocodePoint) {
    return this.guarded(() => this.geocoder.reverse(point));
  }

  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof GeocoderError) throw geocodingUnavailable();
      throw error;
    }
  }
}
