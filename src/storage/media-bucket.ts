import { type MediaBucket, MediaRefusal } from "@softistx/alxia-media";
import { bindBucket, defineBucket } from "@softistx/s3";

// The one private bucket the media routes serve from, an object at
// `<kind>/<key>[/<size>]` (the package chooses the layout, the bucket's key is
// the `key` it is given). No public endpoint, no CORS rule, nothing signed for
// a browser: the browser reaches a photo through the API's `/media` routes.
export interface MediaBucketConfig {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string | undefined;
}

export const s3MediaBucket = (config: MediaBucketConfig): MediaBucket =>
  bindBucket(
    defineBucket({ bucket: config.bucket, key: (p: { key: string }) => p.key }),
    {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region ?? "us-east-1",
      virtualHostedStyle: false,
      endpoint: config.endpoint,
    },
  );

// No storage (S3_* unset outside production): every media route answers 503.
export const noMediaBucket: MediaBucket = {
  open: async () => {
    throw new MediaRefusal("unavailable");
  },
  put: async () => {
    throw new MediaRefusal("unavailable");
  },
  delete: async () => {
    throw new MediaRefusal("unavailable");
  },
};
