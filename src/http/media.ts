import { definePlugin } from "@softistx/alxia";
import { type MediaBucket, mediaRoutes } from "@softistx/alxia-media";
import type { Access, Viewer } from "../auth/access";
import type { AppMongo } from "../config/db";
import { ListingMedia, listingKinds } from "../modules/listings";
import { requireClientMiddleware } from "./csrf";

export const MEDIA_PREFIX = "/media";

// The `/media` routes: the only transport beside `/graphql` (a photo is a
// file, never GraphQL bytes, and the bucket is private: no presigned URL). They
// need the client header like `/graphql`, and read the viewer the base's
// middleware resolved, so mount them after it. A kind's callbacks read
// `listingMedia`, derived per request.
export const mediaApp = (
  deps: { mongo: AppMongo; access: Access },
  bucket: MediaBucket,
) =>
  definePlugin<{ viewer: Viewer | null }>()((app) =>
    app
      .use(MEDIA_PREFIX, requireClientMiddleware)
      .derive(({ viewer }) => ({
        listingMedia: new ListingMedia({
          viewer,
          access: deps.access,
          mongo: deps.mongo,
        }),
      }))
      .plugin(
        mediaRoutes(listingKinds, {
          bucket,
          prefix: MEDIA_PREFIX,
          uploaded: async (uploaded, { listingMedia }) => {
            await listingMedia.recordUpload(uploaded);
            return { key: uploaded.key };
          },
        }),
      ),
  );
