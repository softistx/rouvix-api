import { ObjectId } from "mongodb";
import type { AppMongo } from "@/config/db";
import type { ListingDocument } from "./listings.service";

export type ListingEmbedding = NonNullable<ListingDocument["embedding"]>;

// The vectors of the listings' text (spec §4.4), which the embedding job of
// src/modules/ai makes and the search's ranker compares a query to. They are
// derived fields: the module keeps them, so its collection is written here and
// nowhere else, and they are never returned.
export class ListingEmbeddings {
  constructor(private readonly mongo: AppMongo) {}

  // Stores the vector of a listing's text, under the version it was made from:
  // false when the listing was written since (its own job embeds the new text),
  // is gone, or is an ID document's, which is never embedded. The version and
  // the stamps stay: nothing a person wrote changed.
  async store(
    id: string,
    version: number,
    embedding: ListingEmbedding,
  ): Promise<boolean> {
    const { modifiedCount } = await this.mongo.db.listings.raw.updateOne(
      { _id: new ObjectId(id), version, documentType: null },
      { $set: { embedding } },
    );
    return modifiedCount === 1;
  }

  // The stored vectors of these listings made by `model`, by id (hex); a
  // listing with none, or another model's, is absent.
  async of(
    ids: readonly ObjectId[],
    model: string,
  ): Promise<Map<string, readonly number[]>> {
    const found = await this.mongo.db.listings.raw
      .find(
        { _id: { $in: [...ids] }, "embedding.model": model },
        { projection: { "embedding.vector": 1 } },
      )
      .toArray();
    return new Map(
      found.flatMap((doc) =>
        doc.embedding ? [[doc._id.toHexString(), doc.embedding.vector]] : [],
      ),
    );
  }
}
